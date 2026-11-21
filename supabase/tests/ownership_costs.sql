-- Run as postgres/admin after migration 0015. All fixtures roll back.
begin;
insert into auth.users (id) values
  ('99999999-9999-4999-8999-999999999a01'),
  ('99999999-9999-4999-8999-999999999a02');
insert into public.cars (id, user_id, name, year, make, model, odometer) values
  ('99999999-9999-4999-8999-999999999a03', '99999999-9999-4999-8999-999999999a01',
   'Cost test', 2020, 'Toyota', 'RAV4', 1000),
  ('99999999-9999-4999-8999-999999999a04', '99999999-9999-4999-8999-999999999a02',
   'Other owner car', 2021, 'Honda', 'Civic', 1000);

set local role authenticated;
select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999a01', true);
do $$
declare
  vehicle uuid := '99999999-9999-4999-8999-999999999a03';
  cost uuid := '99999999-9999-4999-8999-999999999a05';
  fill uuid := '99999999-9999-4999-8999-999999999a06';
  usd jsonb := '{"currency":"MXN","date":"2026-10-01","totalCostCents":100000,"convertedCents":5000,"source":"automatic","rate":0.05,"rateDate":"2026-10-01"}';
begin
  insert into public.expenses (id, user_id, car_id, expense_date, category, description,
    total_cost_cents, currency, renews_on)
  values (cost, auth.uid(), vehicle, '2026-10-01', 'insurance', '6-month policy', 100000, 'MXN',
    '2027-04-01');
  if (select count(*) from public.expenses) <> 1 then raise exception 'Owner cannot read costs'; end if;

  -- Background conversions apply once, and only while the inputs match.
  perform public.save_expense_conversion(cost, 'MXN', '2026-10-01', 99999, 'USD', usd);
  if (select conversions from public.expenses where id = cost) <> '{}'::jsonb then
    raise exception 'Stale cost conversion accepted';
  end if;
  perform public.save_expense_conversion(cost, 'MXN', '2026-10-01', 100000, 'USD', usd);
  if (select conversions->'USD'->>'convertedCents' from public.expenses where id = cost) <> '5000' then
    raise exception 'Cost conversion was not saved';
  end if;
  begin
    perform public.save_expense_conversion(cost, 'MXN', '2026-10-01', 100000, 'CAD',
      '{"currency":"MXN","date":"2026-10-01","totalCostCents":100000,"convertedCents":7000,"source":"manual","rate":null,"rateDate":null}');
    raise exception 'Manual cost conversion accepted';
  exception when raise_exception then
    if sqlerrm <> 'Invalid conversion' then raise; end if;
  end;

  -- Edits that keep the inputs keep the conversion; a changed total drops it.
  update public.expenses set notes = 'Edited', conversions = '{}' where id = cost;
  if not (select conversions ? 'USD' from public.expenses where id = cost) then
    raise exception 'Edit dropped a matching cost conversion';
  end if;
  update public.expenses set total_cost_cents = 90000 where id = cost;
  if (select conversions from public.expenses where id = cost) <> '{}'::jsonb then
    raise exception 'Changed cost kept a stale conversion';
  end if;

  insert into public.fuel_entries (id, user_id, car_id, fuel_date, odometer, volume_milli,
    volume_unit, fuel_type, unit_price_milli, total_cost_cents, currency)
  values (fill, auth.uid(), vehicle, '2026-10-01', 1200, 40000, 'liters', 'regular', 2500, 100000, 'MXN');
  perform public.save_fuel_conversion(fill, 'MXN', '2026-10-01', 100000, 'USD', usd);
  update public.fuel_entries set notes = 'Edited', conversions = '{}' where id = fill;
  if (select conversions->'USD'->>'convertedCents' from public.fuel_entries where id = fill) <> '5000' then
    raise exception 'Fill-up conversion was not kept';
  end if;
  update public.fuel_entries set total_cost_cents = 90000 where id = fill;
  if (select conversions from public.fuel_entries where id = fill) <> '{}'::jsonb then
    raise exception 'Changed fill-up kept a stale conversion';
  end if;

  begin
    insert into public.expenses (id, user_id, car_id, expense_date, category, total_cost_cents, renews_on)
    values (gen_random_uuid(), auth.uid(), vehicle, '2026-10-01', 'insurance', 1, '2026-10-01');
    raise exception 'Renewal on the cost date accepted';
  exception when check_violation then null; end;
  begin
    insert into public.expenses (id, user_id, car_id, expense_date, category, total_cost_cents)
    values (gen_random_uuid(), auth.uid(), vehicle, '2026-10-01', 'fuel', 1);
    raise exception 'Unknown category accepted';
  exception when check_violation then null; end;
  begin
    insert into public.expenses (id, user_id, car_id, expense_date, category, total_cost_cents)
    values (gen_random_uuid(), auth.uid(), vehicle, '2026-10-01', 'tolls', -1);
    raise exception 'Negative cost accepted';
  exception when check_violation then null; end;
  begin
    insert into public.expenses (id, user_id, car_id, expense_date, category, total_cost_cents, description)
    values (gen_random_uuid(), auth.uid(), vehicle, '2026-10-01', 'tolls', 1, repeat('d', 101));
    raise exception 'Long description accepted';
  exception when check_violation then null; end;
  begin
    insert into public.expenses (id, user_id, car_id, expense_date, category, total_cost_cents, currency)
    values (gen_random_uuid(), auth.uid(), vehicle, '2026-10-01', 'tolls', 1, 'EUR');
    raise exception 'Unsupported currency accepted';
  exception when check_violation then null; end;
  begin
    insert into public.fuel_entries (id, user_id, car_id, fuel_date, odometer, volume_milli,
      volume_unit, fuel_type, unit_price_milli, total_cost_cents, currency, conversions)
    values (gen_random_uuid(), auth.uid(), vehicle, '2026-10-02', 1300, 1000, 'liters', 'regular',
      1, 100000, 'MXN',
      '{"USD":{"currency":"MXN","date":"2026-10-02","totalCostCents":100000,"convertedCents":1,"source":"manual","rate":null,"rateDate":null}}');
    raise exception 'Manual fill-up conversion accepted';
  exception when check_violation then null; end;
  begin
    -- The composite key rejects a cost for another owner's vehicle.
    insert into public.expenses (id, user_id, car_id, expense_date, category, total_cost_cents)
    values (gen_random_uuid(), auth.uid(), '99999999-9999-4999-8999-999999999a04', '2026-10-01',
      'tolls', 1);
    raise exception 'Cost accepted for another owner''s vehicle';
  exception when foreign_key_violation then null; end;
end $$;

select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999a02', true);
do $$ begin
  if exists (select from public.expenses) then raise exception 'Other owner can read costs'; end if;
  update public.expenses set notes = 'Hijacked';
  if found then raise exception 'Other owner can edit costs'; end if;
  delete from public.expenses;
  if found then raise exception 'Other owner can delete costs'; end if;
  perform public.save_expense_conversion('99999999-9999-4999-8999-999999999a05', 'MXN',
    '2026-10-01', 90000, 'CAD',
    '{"currency":"MXN","date":"2026-10-01","totalCostCents":90000,"convertedCents":6300,"source":"automatic","rate":0.07,"rateDate":"2026-10-01"}');
  perform public.save_fuel_conversion('99999999-9999-4999-8999-999999999a06', 'MXN',
    '2026-10-01', 90000, 'CAD',
    '{"currency":"MXN","date":"2026-10-01","totalCostCents":90000,"convertedCents":6300,"source":"automatic","rate":0.07,"rateDate":"2026-10-01"}');
  begin
    insert into public.expenses (id, user_id, car_id, expense_date, category, total_cost_cents)
    values (gen_random_uuid(), '99999999-9999-4999-8999-999999999a01',
      '99999999-9999-4999-8999-999999999a03', '2026-10-01', 'tolls', 1);
    raise exception 'Other owner can insert with spoofed ownership';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role anon;
do $$ begin
  perform 1 from public.expenses;
  raise exception 'Anonymous role can read costs';
exception when insufficient_privilege then null; end $$;

reset role;
do $$ begin
  if (select conversions from public.expenses where id = '99999999-9999-4999-8999-999999999a05')
    <> '{}'::jsonb then
    raise exception 'Other owner converted a cost';
  end if;
  if (select conversions from public.fuel_entries where id = '99999999-9999-4999-8999-999999999a06')
    <> '{}'::jsonb then
    raise exception 'Other owner converted a fill-up';
  end if;
  delete from public.cars where id = '99999999-9999-4999-8999-999999999a03';
  if exists (select from public.expenses where car_id = '99999999-9999-4999-8999-999999999a03') then
    raise exception 'Deleting a vehicle kept its costs';
  end if;
end $$;
rollback;
