-- Run as postgres/admin after migration 0009. All fixtures roll back.
begin;
insert into auth.users (id) values
  ('99999999-9999-4999-8999-999999999991'),
  ('99999999-9999-4999-8999-999999999992');
insert into public.cars (id, user_id, name, year, make, model, odometer) values
  ('99999999-9999-4999-8999-999999999993', '99999999-9999-4999-8999-999999999991',
    'Baseline car', 2020, 'Toyota', 'RAV4', 69000);

set local role authenticated;
select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999991', true);
do $$
declare
  payload jsonb := '{"id":"99999999-9999-4999-8999-999999999994","user_id":"99999999-9999-4999-8999-999999999991","car_id":"99999999-9999-4999-8999-999999999993","name":"New task","interval_miles":5000,"interval_months":6,"first_due_miles":null,"first_due_date":null,"source_note":"Manual","is_active":true,"created_at":"2026-10-13T19:00:00Z"}';
  saved public.schedule_items;
  before_failure public.schedule_items;
  failed boolean := false;
begin
  update public.cars set odometer = 71000;
  select * into saved from public.save_schedule_with_defaults(
    '99999999-9999-4999-8999-999999999991', payload, '2026-10-13');
  if saved.first_due_miles is distinct from 75000 or saved.first_due_date is distinct from '2027-04-13'::date then
    raise exception 'New task used a stale car reading';
  end if;
  if (select first_due_miles from public.schedule_items where id = saved.id) is distinct from 75000 then
    raise exception 'Initialized target was not persisted';
  end if;

  update public.cars set odometer = 69000;
  insert into public.visits (id, user_id, car_id, service_date, odometer, total_cost_cents) values
    ('99999999-9999-4999-8999-999999999995', '99999999-9999-4999-8999-999999999991',
      '99999999-9999-4999-8999-999999999993', '2026-10-12', 71000, 0);
  delete from public.schedule_items where id = saved.id;
  select * into saved from public.save_schedule_with_defaults(
    '99999999-9999-4999-8999-999999999991', payload, '2026-10-13');
  if saved.first_due_miles is distinct from 75000 then
    raise exception 'New task used a stale visit reading';
  end if;

  payload := payload || '{"name":"Edited task","interval_miles":10000}'::jsonb;
  select * into saved from public.save_schedule_with_defaults(
    '99999999-9999-4999-8999-999999999991', payload, '2026-10-13');
  if saved.first_due_miles is distinct from 80000 or saved.name is distinct from 'Edited task' then
    raise exception 'Existing task edit was not saved and initialized together';
  end if;
  before_failure := saved;
  begin
    perform public.save_schedule_with_defaults(
      '99999999-9999-4999-8999-999999999991', payload, null);
  exception when raise_exception then failed := true;
  end;
  select * into saved from public.schedule_items where id = before_failure.id;
  if not failed or saved is distinct from before_failure then
    raise exception 'Failed initialization left a partial schedule write';
  end if;

  select * into saved from public.save_schedule_with_defaults(
    '99999999-9999-4999-8999-999999999991', payload || '{"is_active":false}'::jsonb, '2026-10-13');
  if saved.is_active or saved.first_due_miles is not null or saved.first_due_date is not null then
    raise exception 'Inactive save was initialized';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999992', true);
do $$ begin
  begin
    perform public.save_schedule_with_defaults(
      '99999999-9999-4999-8999-999999999991',
      '{"user_id":"99999999-9999-4999-8999-999999999991","car_id":"99999999-9999-4999-8999-999999999993"}',
      '2026-10-13');
    raise exception 'Cross-account save succeeded';
  exception when foreign_key_violation then null; end;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon', 'public.save_schedule_with_defaults(uuid,jsonb,date)', 'EXECUTE')
    or (select prosecdef from pg_proc where oid = 'public.save_schedule_with_defaults(uuid,jsonb,date)'::regprocedure) then
    raise exception 'Atomic save bypasses caller permissions';
  end if;
end $$;
rollback;
