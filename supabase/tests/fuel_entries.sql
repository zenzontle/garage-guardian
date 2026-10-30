-- Run as postgres/admin after migration 0012. All fixtures roll back.
begin;
insert into auth.users (id) values
  ('99999999-9999-4999-8999-999999999991'),
  ('99999999-9999-4999-8999-999999999992');
insert into public.cars (id, user_id, name, year, make, model, odometer) values
  ('99999999-9999-4999-8999-999999999993', '99999999-9999-4999-8999-999999999991',
   'Fuel test', 2020, 'Toyota', 'RAV4', 69000),
  ('99999999-9999-4999-8999-999999999994', '99999999-9999-4999-8999-999999999992',
   'Other owner car', 2021, 'Honda', 'Civic', 1000);
insert into public.schedule_items (id, user_id, car_id, name, interval_miles, interval_months) values
  ('99999999-9999-4999-8999-999999999995', '99999999-9999-4999-8999-999999999991',
   '99999999-9999-4999-8999-999999999993', 'Interval-only task', 5000, 6);

set local role authenticated;
select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999991', true);
do $$
declare
  vehicle uuid := '99999999-9999-4999-8999-999999999993';
  entry uuid := '99999999-9999-4999-8999-999999999996';
  item public.schedule_items;
begin
  insert into public.fuel_entries (
    id, user_id, car_id, fuel_date, odometer, volume_milli, volume_unit, fuel_type,
    unit_price_milli, total_cost_cents, currency, is_full_tank, missed_previous, station, notes, photos
  ) values (
    entry, auth.uid(), vehicle, '2026-10-12', 71000, 12345, 'gallons', 'regular',
    3459, 4270, 'USD', true, false, 'Corner station', 'Owner fill-up',
    '[{"id":"receipt","path":"99999999-9999-4999-8999-999999999991/fuel/receipt.webp","name":"receipt.webp","contentType":"image/webp"}]'
  );
  update public.fuel_entries set notes = 'Edited' where id = entry;
  if (select notes from public.fuel_entries where id = entry) <> 'Edited' then
    raise exception 'Owner cannot edit a fill-up';
  end if;
  if (select count(*) from public.fuel_entries) <> 1 then raise exception 'Owner cannot read fill-ups'; end if;

  -- The first due distance uses a fill-up reading above the car and visit readings.
  select * into item from public.initialize_schedule_defaults(
    auth.uid(), '99999999-9999-4999-8999-999999999995', vehicle, 5000, 6, '2026-10-13');
  if item.first_due_miles is distinct from 75000 or item.first_due_date is distinct from '2027-04-13'::date then
    raise exception 'Fill-up odometer was not used as the baseline';
  end if;

  begin
    insert into public.fuel_entries (id, user_id, car_id, fuel_date, odometer, volume_milli, volume_unit,
      fuel_type, unit_price_milli, total_cost_cents)
    values (gen_random_uuid(), auth.uid(), vehicle, '2026-10-13', 71100, 0, 'gallons', 'regular', 1, 1);
    raise exception 'Zero volume accepted';
  exception when check_violation then null; end;
  begin
    insert into public.fuel_entries (id, user_id, car_id, fuel_date, odometer, volume_milli, volume_unit,
      fuel_type, unit_price_milli, total_cost_cents)
    values (gen_random_uuid(), auth.uid(), vehicle, '2026-10-13', 71100, 2000001, 'liters', 'regular', 1, 1);
    raise exception 'Oversized volume accepted';
  exception when check_violation then null; end;
  begin
    insert into public.fuel_entries (id, user_id, car_id, fuel_date, odometer, volume_milli, volume_unit,
      fuel_type, unit_price_milli, total_cost_cents)
    values (gen_random_uuid(), auth.uid(), vehicle, '2026-10-13', 71100, 1000, 'pints', 'regular', 1, 1);
    raise exception 'Unknown volume unit accepted';
  exception when check_violation then null; end;
  begin
    insert into public.fuel_entries (id, user_id, car_id, fuel_date, odometer, volume_milli, volume_unit,
      fuel_type, unit_price_milli, total_cost_cents)
    values (gen_random_uuid(), auth.uid(), vehicle, '2026-10-13', 71100, 1000, 'gallons', 'jet', 1, 1);
    raise exception 'Unknown fuel type accepted';
  exception when check_violation then null; end;
  begin
    insert into public.fuel_entries (id, user_id, car_id, fuel_date, odometer, volume_milli, volume_unit,
      fuel_type, unit_price_milli, total_cost_cents)
    values (gen_random_uuid(), auth.uid(), vehicle, '2026-10-13', -1, 1000, 'gallons', 'regular', 1, 1);
    raise exception 'Negative odometer accepted';
  exception when check_violation then null; end;
  begin
    insert into public.fuel_entries (id, user_id, car_id, fuel_date, odometer, volume_milli, volume_unit,
      fuel_type, unit_price_milli, total_cost_cents, currency)
    values (gen_random_uuid(), auth.uid(), vehicle, '2026-10-13', 71100, 1000, 'gallons', 'regular', 1, 1, 'EUR');
    raise exception 'Unsupported currency accepted';
  exception when check_violation then null; end;
  begin
    insert into public.fuel_entries (id, user_id, car_id, fuel_date, odometer, volume_milli, volume_unit,
      fuel_type, unit_price_milli, total_cost_cents, station)
    values (gen_random_uuid(), auth.uid(), vehicle, '2026-10-13', 71100, 1000, 'gallons', 'regular', 1, 1, repeat('s', 101));
    raise exception 'Long station accepted';
  exception when check_violation then null; end;
  begin
    insert into public.fuel_entries (id, user_id, car_id, fuel_date, odometer, volume_milli, volume_unit,
      fuel_type, unit_price_milli, total_cost_cents, photos)
    values (gen_random_uuid(), auth.uid(), vehicle, '2026-10-13', 71100, 1000, 'gallons', 'regular', 1, 1,
      '[{},{},{},{}]');
    raise exception 'Four photos accepted';
  exception when check_violation then null; end;
  begin
    -- The composite key rejects a fill-up for another owner's vehicle.
    insert into public.fuel_entries (id, user_id, car_id, fuel_date, odometer, volume_milli, volume_unit,
      fuel_type, unit_price_milli, total_cost_cents)
    values (gen_random_uuid(), auth.uid(), '99999999-9999-4999-8999-999999999994', '2026-10-13', 1,
      1000, 'gallons', 'regular', 1, 1);
    raise exception 'Fill-up accepted for another owner''s vehicle';
  exception when foreign_key_violation then null; end;
end $$;

select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999992', true);
do $$ begin
  if exists (select from public.fuel_entries) then raise exception 'Other owner can read fill-ups'; end if;
  update public.fuel_entries set notes = 'Hijacked';
  if found then raise exception 'Other owner can edit fill-ups'; end if;
  delete from public.fuel_entries;
  if found then raise exception 'Other owner can delete fill-ups'; end if;
  begin
    insert into public.fuel_entries (id, user_id, car_id, fuel_date, odometer, volume_milli, volume_unit,
      fuel_type, unit_price_milli, total_cost_cents)
    values (gen_random_uuid(), '99999999-9999-4999-8999-999999999991',
      '99999999-9999-4999-8999-999999999993', '2026-10-13', 1, 1000, 'gallons', 'regular', 1, 1);
    raise exception 'Other owner can insert with spoofed ownership';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role anon;
do $$ begin
  perform 1 from public.fuel_entries;
  raise exception 'Anonymous role can read fill-ups';
exception when insufficient_privilege then null; end $$;

reset role;
do $$ begin
  if (select notes from public.fuel_entries where id = '99999999-9999-4999-8999-999999999996') <> 'Edited' then
    raise exception 'Owner isolation failed';
  end if;
  delete from public.cars where id = '99999999-9999-4999-8999-999999999993';
  if exists (select from public.fuel_entries where car_id = '99999999-9999-4999-8999-999999999993') then
    raise exception 'Deleting a vehicle kept its fill-ups';
  end if;
end $$;
rollback;
