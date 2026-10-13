-- Run as postgres/admin after migration 0008. All fixtures roll back.
begin;
insert into auth.users (id) values
  ('88888888-8888-4888-8888-888888888881'),
  ('88888888-8888-4888-8888-888888888882');
insert into public.cars (id, user_id, name, year, make, model, odometer) values
  ('88888888-8888-4888-8888-888888888883', '88888888-8888-4888-8888-888888888881',
    'Baseline car', 2020, 'Toyota', 'RAV4', 69000);
insert into public.schedule_items (id, user_id, car_id, name, interval_miles, interval_months) values
  ('88888888-8888-4888-8888-888888888884', '88888888-8888-4888-8888-888888888881',
    '88888888-8888-4888-8888-888888888883', 'Interval-only task', 5000, 6);

set local role authenticated;
select set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888881', true);
do $$
declare
  item public.schedule_items;
  baseline integer;
  expected integer;
begin
  -- A change that committed after the application's snapshot must supply the baseline.
  update public.cars set odometer = 71000;
  select * into item from public.initialize_schedule_defaults(
    '88888888-8888-4888-8888-888888888881', '88888888-8888-4888-8888-888888888884',
    '88888888-8888-4888-8888-888888888883', 5000, 6, '2026-10-13');
  if item.first_due_miles is distinct from 75000 or item.first_due_date is distinct from '2027-04-13'::date then
    raise exception 'Stale car baseline or incorrect date';
  end if;
  update public.cars set odometer = 69000;
  update public.schedule_items set first_due_miles = null, first_due_date = null;
  insert into public.visits (id, user_id, car_id, service_date, odometer, total_cost_cents) values
    ('88888888-8888-4888-8888-888888888885', '88888888-8888-4888-8888-888888888881',
      '88888888-8888-4888-8888-888888888883', '2026-10-12', 71000, 0),
    ('88888888-8888-4888-8888-888888888886', '88888888-8888-4888-8888-888888888881',
      '88888888-8888-4888-8888-888888888883', '2026-10-13', null, 0);
  select * into item from public.initialize_schedule_defaults(
    '88888888-8888-4888-8888-888888888881', '88888888-8888-4888-8888-888888888884',
    '88888888-8888-4888-8888-888888888883', 5000, 6, '2026-10-13');
  if item.first_due_miles is distinct from 75000 then raise exception 'Stale visit baseline'; end if;
  delete from public.visits;

  foreach baseline in array array[0, 5000, 5001] loop
    expected := case when baseline <= 5000 then 5000 else 10000 end;
    update public.cars set odometer = baseline, distance_unit = 'kilometers';
    update public.schedule_items set first_due_miles = null, first_due_date = null, interval_months = 1;
    select * into item from public.initialize_schedule_defaults(
      '88888888-8888-4888-8888-888888888881', '88888888-8888-4888-8888-888888888884',
      '88888888-8888-4888-8888-888888888883', 5000, 1, '2026-01-31');
    if item.first_due_miles is distinct from expected or item.first_due_date is distinct from '2026-02-28'::date then
      raise exception 'Incorrect native-unit milestone or month-end date';
    end if;
  end loop;

  update public.schedule_items set first_due_miles = null, first_due_date = null,
    interval_miles = null, interval_months = 6;
  select * into item from public.initialize_schedule_defaults(
    '88888888-8888-4888-8888-888888888881', '88888888-8888-4888-8888-888888888884',
    '88888888-8888-4888-8888-888888888883', null, 6, '2026-10-13');
  if item.first_due_miles is not null or item.first_due_date is distinct from '2027-04-13'::date then
    raise exception 'Incorrect time-only default';
  end if;

  -- A lost guard returns the actual row without changing its due points.
  update public.schedule_items set name = 'Edited task', first_due_miles = null,
    first_due_date = null, interval_miles = 10000;
  select * into item from public.initialize_schedule_defaults(
    '88888888-8888-4888-8888-888888888881', '88888888-8888-4888-8888-888888888884',
    '88888888-8888-4888-8888-888888888883', 5000, 6, '2026-10-13');
  if item.name is distinct from 'Edited task' or item.interval_miles is distinct from 10000
    or item.first_due_miles is not null or item.first_due_date is not null then
    raise exception 'Stale row returned or interval edit overwritten';
  end if;
  update public.schedule_items set is_active = false;
  select * into item from public.initialize_schedule_defaults(
    '88888888-8888-4888-8888-888888888881', '88888888-8888-4888-8888-888888888884',
    '88888888-8888-4888-8888-888888888883', 10000, 6, '2026-10-13');
  if item.is_active or item.first_due_miles is not null or item.first_due_date is not null then
    raise exception 'Inactive row initialized or stale active state returned';
  end if;
  update public.schedule_items set is_active = true, first_due_miles = 80000, first_due_date = '2028-01-01';
  select * into item from public.initialize_schedule_defaults(
    '88888888-8888-4888-8888-888888888881', '88888888-8888-4888-8888-888888888884',
    '88888888-8888-4888-8888-888888888883', 10000, 6, '2026-10-13');
  if item.first_due_miles is distinct from 80000 or item.first_due_date is distinct from '2028-01-01'::date then
    raise exception 'Explicit due points overwritten';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888882', true);
do $$ begin
  if exists (select 1 from public.initialize_schedule_defaults(
    '88888888-8888-4888-8888-888888888881', '88888888-8888-4888-8888-888888888884',
    '88888888-8888-4888-8888-888888888883', 10000, 6, '2026-10-13')) then
    raise exception 'Cross-account row exposed';
  end if;
end $$;
reset role;
set local role service_role;
do $$ begin
  if not exists (select 1 from public.initialize_schedule_defaults(
    '88888888-8888-4888-8888-888888888881', '88888888-8888-4888-8888-888888888884',
    '88888888-8888-4888-8888-888888888883', 10000, 6, '2026-10-13')) then
    raise exception 'Reminder worker cannot initialize owner records';
  end if;
end $$;
reset role;
delete from public.schedule_items where id = '88888888-8888-4888-8888-888888888884';
do $$ begin
  if exists (select 1 from public.initialize_schedule_defaults(
    '88888888-8888-4888-8888-888888888881', '88888888-8888-4888-8888-888888888884',
    '88888888-8888-4888-8888-888888888883', 10000, 6, '2026-10-13')) then
    raise exception 'Deleted task returned';
  end if;
  if has_function_privilege('anon', 'public.initialize_schedule_defaults(uuid,uuid,uuid,integer,integer,date)', 'EXECUTE')
    or (select prosecdef from pg_proc where oid = 'public.initialize_schedule_defaults(uuid,uuid,uuid,integer,integer,date)'::regprocedure) then
    raise exception 'Initializer bypasses caller permissions';
  end if;
end $$;
rollback;
