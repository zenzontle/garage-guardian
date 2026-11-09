-- Run as postgres/admin after migration 0014. All fixtures roll back.
begin;
insert into auth.users (id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
insert into public.cars (id, user_id, name, year, make, model, odometer) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
   'Deleted owner car', 2020, 'Toyota', 'RAV4', 1000),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
   'Other owner car', 2021, 'Honda', 'Civic', 2000);
insert into public.notification_preferences (user_id, enabled, weekday) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true, 1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', true, 1);
insert into storage.objects (bucket_id, name) values
  ('visit-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/visit-1/b.webp'),
  ('visit-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/visit-1/a.webp'),
  ('visit-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/visit-2/a.webp'),
  -- A sibling ID that shares a prefix but not the folder must never be listed.
  ('visit-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1x/visit-3/a.webp');

do $$ begin
  if has_table_privilege('authenticated', 'public.account_deletion_requests', 'SELECT')
    or has_table_privilege('authenticated', 'public.account_deletion_requests', 'INSERT')
    or has_table_privilege('anon', 'public.account_deletion_requests', 'SELECT')
    or has_function_privilege('authenticated', 'public.request_account_deletion(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_account_deletions(integer, uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.account_photo_paths(uuid, integer)', 'EXECUTE')
    or has_function_privilege('anon', 'public.account_photo_paths(uuid, integer)', 'EXECUTE') then
    raise exception 'Clients can reach the server-only deletion queue';
  end if;
end $$;

-- Before a request, the owner can still upload into their own folder.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
insert into storage.objects (bucket_id, name)
  values ('visit-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/visit-1/c.webp');
reset role;

set local role service_role;
do $$
declare
  first_request timestamptz;
  claimed uuid[];
  paths text[];
begin
  first_request := public.request_account_deletion('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  if public.request_account_deletion('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') <> first_request
    or (select count(*) from public.account_deletion_requests) <> 1 then
    raise exception 'Repeated request was not idempotent';
  end if;
  if (select enabled from public.notification_preferences
      where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')
    or not (select enabled from public.notification_preferences
      where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2') then
    raise exception 'Request must stop only the requesting account''s reminders';
  end if;

  select array_agg(name) into paths
    from public.account_photo_paths('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 2);
  if paths <> array[
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/visit-1/a.webp',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/visit-1/b.webp'
  ] then
    raise exception 'Photo paths were not limited and ordered: %', paths;
  end if;
  select array_agg(name) into paths
    from public.account_photo_paths('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 5000);
  if cardinality(paths) <> 3
    or exists (select 1 from unnest(paths) as path
      where path not like 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/%') then
    raise exception 'Photo paths included another account''s folder: %', paths;
  end if;

  select array_agg(user_id) into claimed from public.claim_account_deletions(10);
  if claimed <> array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid] then
    raise exception 'Claim did not lease the queued request';
  end if;
  if exists (select 1 from public.claim_account_deletions(10))
    or exists (select 1 from public.claim_account_deletions(1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')) then
    raise exception 'A leased request was claimed twice';
  end if;
  if exists (select 1 from public.claim_account_deletions(1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')) then
    raise exception 'An account without a request was claimed';
  end if;
  update public.account_deletion_requests set locked_until = now() - interval '1 second';
  select array_agg(user_id) into claimed
    from public.claim_account_deletions(1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  if claimed <> array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid]
    or (select attempts from public.account_deletion_requests) <> 2 then
    raise exception 'An expired lease was not reclaimed';
  end if;
end $$;
reset role;

-- Once deletion is requested, a still-valid access token cannot add or replace photos.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
do $$ begin
  begin
    insert into storage.objects (bucket_id, name)
      values ('visit-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/visit-1/d.webp');
    raise exception 'Upload succeeded after deletion was requested';
  exception when insufficient_privilege then null; end;
  begin
    update storage.objects set metadata = '{}'::jsonb
      where name = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/visit-1/a.webp';
    raise exception 'Photo replaced after deletion was requested';
  exception when insufficient_privilege then null; end;
end $$;
-- Re-enabling reminders with that token must not lead to another digest.
update public.notification_preferences set enabled = true;
reset role;
update public.notification_preferences set next_scheduled_at = now() - interval '1 day'
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
set local role service_role;
do $$ begin
  if public.claim_reminder('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') is not null
    or exists (select 1 from public.reminder_deliveries
      where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') then
    raise exception 'A queued account was claimed for a reminder';
  end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', true);
insert into storage.objects (bucket_id, name)
  values ('visit-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/visit-2/b.webp');
reset role;

delete from auth.users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
do $$ begin
  if exists (select 1 from public.account_deletion_requests)
    or exists (select 1 from public.cars where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')
    or exists (select 1 from public.notification_preferences
      where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') then
    raise exception 'Deleting the user did not cascade to its data and request';
  end if;
  if not exists (select 1 from public.cars where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2') then
    raise exception 'Deletion removed another account''s data';
  end if;
end $$;

-- After the auth user is gone, its leftover access token still cannot upload.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
do $$ begin
  begin
    insert into storage.objects (bucket_id, name)
      values ('visit-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/visit-1/e.webp');
    raise exception 'Upload succeeded after the account was deleted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
