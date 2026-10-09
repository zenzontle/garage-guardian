-- Run after migrations 0001-0007 on a test project. No fixture data survives.
begin;
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'account-policy-test@example.invalid'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'other-policy-test@example.invalid');
insert into public.cars (id, user_id, name, year, make, model, odometer) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Delete fixture', 2020, 'Test', 'Test', 0),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Keep fixture', 2020, 'Test', 'Test', 0);
insert into public.schedule_items (id, user_id, car_id, name) values
  ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-4000-8000-000000000001', 'Test');
insert into public.visits (id, user_id, car_id, service_date, odometer, total_cost_cents) values
  ('aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-4000-8000-000000000001', current_date, 0, 0);
insert into public.reminder_deliveries (user_id, week_start) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', current_date);

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
insert into storage.objects (bucket_id, name) values ('visit-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/allowed.webp');
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('visit-photos', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/denied.webp');
    raise exception 'Cross-owner upload unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$ begin
  if has_table_privilege('authenticated', 'public.account_deletion_locks', 'insert,update')
    or has_table_privilege('anon', 'public.account_deletion_locks', 'insert,update')
    or not has_table_privilege('service_role', 'public.account_deletion_locks', 'insert')
    or not has_table_privilege('service_role', 'public.account_deletion_locks', 'update')
  then raise exception 'Deletion barrier permissions are incorrect'; end if;
end $$;
set local role service_role;
insert into public.account_deletion_locks (user_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
on conflict (user_id) do update set user_id = excluded.user_id;
-- Retrying an existing fence is idempotent.
insert into public.account_deletion_locks (user_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
on conflict (user_id) do update set user_id = excluded.user_id;
reset role;
-- Storage completion uses elevated privileges. RLS bypass must not bypass the
-- final metadata commit guard, for either new uploads or overwrites.
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('visit-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/late-completion.webp');
    raise exception 'Elevated late upload unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    update storage.objects set metadata = '{"late":true}' where bucket_id = 'visit-photos' and name = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/allowed.webp';
    raise exception 'Elevated late overwrite unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
do $$ begin
  if public.account_can_write_photos() then raise exception 'Deletion fence did not block writes'; end if;
  begin
    insert into storage.objects (bucket_id, name) values ('visit-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/fenced.webp');
    raise exception 'Fenced upload unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  update storage.objects set metadata = '{"test":true}' where bucket_id = 'visit-photos' and name = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/allowed.webp';
  if found then raise exception 'Fenced update unexpectedly succeeded'; end if;
end $$;

reset role;
-- Storage deletion uses the API in production; these are rollback-only policy fixtures.
delete from storage.objects where bucket_id = 'visit-photos' and name = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/allowed.webp';
delete from auth.users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$ begin
  if exists (select 1 from public.cars where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    or exists (select 1 from public.schedule_items where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    or exists (select 1 from public.visits where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    or exists (select 1 from public.reminder_deliveries where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    or exists (select 1 from public.account_deletion_locks where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  then raise exception 'Account cascade failed'; end if;
  if not exists (select 1 from public.cars where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'Other account lost data'; end if;
end $$;

set local role authenticated;
-- Same JWT claims after Auth deletion simulate an already-issued access token.
do $$ begin
  if public.account_can_write_photos() then raise exception 'Deleted identity can write'; end if;
  begin
    insert into storage.objects (bucket_id, name) values ('visit-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/stale-token.webp');
    raise exception 'Stale-token upload unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('visit-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/elevated-stale.webp');
    raise exception 'Elevated upload for deleted Auth identity unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  insert into storage.objects (bucket_id, name) values ('visit-photos', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/still-allowed.webp');
end $$;
rollback;
