-- Run as postgres/admin after migration 0010. Fixtures roll back.
begin;
insert into auth.users (id) values
  ('99999999-9999-4999-8999-999999999991'),
  ('99999999-9999-4999-8999-999999999992');
insert into public.cars (id, user_id, name, year, make, model, odometer) values
  ('99999999-9999-4999-8999-999999999993', '99999999-9999-4999-8999-999999999991',
    'Currency test', 2020, 'Toyota', 'RAV4', 100);
insert into public.visits (id, user_id, car_id, service_date, odometer, total_cost_cents) values
  ('99999999-9999-4999-8999-999999999994', '99999999-9999-4999-8999-999999999991',
    '99999999-9999-4999-8999-999999999993', '2024-06-08', 100, 10000);

set local role authenticated;
select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999991', true);
do $$
declare
  receipt uuid := '99999999-9999-4999-8999-999999999994';
  c jsonb := '{"currency":"USD","date":"2024-06-08","totalCostCents":10000,"convertedCents":178880,"source":"automatic","rate":17.888,"rateDate":"2024-06-07"}';
  manual jsonb := '{"currency":"USD","date":"2024-06-08","totalCostCents":10000,"convertedCents":170000,"source":"manual","rate":null,"rateDate":null}';
  saved public.visits;
begin
  select * into saved from public.visits where id = receipt;
  if saved.currency <> 'USD' or saved.total_cost_cents <> 10000 or saved.conversions <> '{}'::jsonb then
    raise exception 'Legacy defaults changed original expense';
  end if;
  insert into public.garage_settings (user_id, home_currency) values (auth.uid(), 'MXN');
  perform public.save_visit_conversion(receipt, 'USD', '2024-06-08', 10000, 'MXN', c);
  if (select conversions->'MXN' from public.visits where id = receipt) is distinct from c then raise exception 'Conversion not saved'; end if;
  update public.visits set conversions = jsonb_build_object('MXN', manual) where id = receipt;
  perform public.save_visit_conversion(receipt, 'USD', '2024-06-08', 10000, 'MXN', c);
  if (select conversions->'MXN' from public.visits where id = receipt) is distinct from manual then raise exception 'Background save replaced manual charge'; end if;
  update public.visits set odometer = 101, conversions = '{}'::jsonb where id = receipt;
  if (select conversions->'MXN' from public.visits where id = receipt) is distinct from manual then raise exception 'Unrelated edit lost conversion'; end if;
  update public.visits set total_cost_cents = 11000 where id = receipt;
  perform public.save_visit_conversion(receipt, 'USD', '2024-06-08', 10000, 'MXN', c);
  if (select conversions from public.visits where id = receipt) <> '{}'::jsonb then raise exception 'Stale amount conversion survived'; end if;
  update public.visits set total_cost_cents = 10000 where id = receipt;
  perform public.save_visit_conversion(receipt, 'USD', '2024-06-08', 10000, 'MXN', c);
  update public.visits set service_date = '2024-06-09' where id = receipt;
  perform public.save_visit_conversion(receipt, 'USD', '2024-06-08', 10000, 'MXN', c);
  if (select conversions from public.visits where id = receipt) <> '{}'::jsonb then raise exception 'Stale date conversion survived'; end if;
  update public.visits set service_date = '2024-06-08', currency = 'CAD' where id = receipt;
  perform public.save_visit_conversion(receipt, 'USD', '2024-06-08', 10000, 'MXN', c);
  if (select conversions from public.visits where id = receipt) <> '{}'::jsonb then raise exception 'Stale currency conversion survived'; end if;

  if public.valid_visit_conversions(jsonb_build_object('EUR', c), 'USD', '2024-06-08', 10000)
    or public.valid_visit_conversions(jsonb_build_object('MXN', c || '{"rateDate":"2024-06-10"}'), 'USD', '2024-06-08', 10000)
    or public.valid_visit_conversions(jsonb_build_object('MXN', c || '{"convertedCents":-1}'), 'USD', '2024-06-08', 10000)
    or public.valid_visit_conversions(jsonb_build_object('MXN', c - 'convertedCents'), 'USD', '2024-06-08', 10000)
    or public.valid_visit_conversions(jsonb_build_object('MXN', c || '{"source":"other"}'), 'USD', '2024-06-08', 10000) then
    raise exception 'Malformed conversion accepted';
  end if;
  begin
    update public.garage_settings set home_currency = 'EUR';
    raise exception 'Unsupported home currency accepted';
  exception when check_violation then null; end;
  begin
    update public.visits set currency = 'EUR' where id = receipt;
    raise exception 'Unsupported receipt currency accepted';
  exception when check_violation then null; end;
end $$;

select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999992', true);
do $$ begin
  if exists (select from public.garage_settings) then raise exception 'Another account read settings'; end if;
  update public.garage_settings set home_currency = 'CAD';
  begin
    insert into public.garage_settings (user_id, home_currency) values ('99999999-9999-4999-8999-999999999991', 'CAD');
    raise exception 'Another account wrote settings';
  exception when insufficient_privilege then null; end;
  perform public.save_visit_conversion('99999999-9999-4999-8999-999999999994', 'CAD', '2024-06-08', 10000, 'USD',
    '{"currency":"CAD","date":"2024-06-08","totalCostCents":10000,"convertedCents":10000,"source":"manual","rate":null,"rateDate":null}');
end $$;
reset role;
do $$ begin
  if (select home_currency from public.garage_settings) <> 'MXN' then raise exception 'Owner settings changed'; end if;
  if (select conversions from public.visits where id = '99999999-9999-4999-8999-999999999994') <> '{}'::jsonb then raise exception 'Cross-account conversion changed'; end if;
end $$;
rollback;
