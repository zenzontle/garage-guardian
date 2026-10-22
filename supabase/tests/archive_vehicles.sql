-- Run as postgres/admin after migration 0011. All fixtures roll back.
begin;
insert into auth.users (id) values
  ('88888888-8888-4888-8888-888888888881'),
  ('88888888-8888-4888-8888-888888888882');
insert into public.cars (id, user_id, name, year, make, model, odometer) values
  ('88888888-8888-4888-8888-888888888883', '88888888-8888-4888-8888-888888888881',
   'Archive test', 2020, 'Toyota', 'RAV4', 10000);
insert into public.schedule_items (id, user_id, car_id, name, interval_miles, first_due_miles) values
  ('88888888-8888-4888-8888-888888888884', '88888888-8888-4888-8888-888888888881',
   '88888888-8888-4888-8888-888888888883', 'Oil', 5000, 9000);
insert into public.visits (id, user_id, car_id, service_date, total_cost_cents, photos) values
  ('88888888-8888-4888-8888-888888888885', '88888888-8888-4888-8888-888888888881',
   '88888888-8888-4888-8888-888888888883', '2026-01-01', 10000,
   '[{"id":"receipt","path":"88888888-8888-4888-8888-888888888881/archive/receipt.webp","name":"receipt.webp","contentType":"image/webp"}]');
insert into storage.objects (bucket_id, name, metadata) values
  ('visit-photos', '88888888-8888-4888-8888-888888888881/archive/receipt.webp', '{"size":7,"mimetype":"image/webp"}');
insert into public.notification_preferences (user_id, enabled) values
  ('88888888-8888-4888-8888-888888888881', false);

set local role authenticated;
select set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888881', true);
do $$
declare
  vehicle uuid := '88888888-8888-4888-8888-888888888883';
  before_car jsonb;
  before_visit jsonb;
  before_schedule jsonb;
  before_photo jsonb;
  before_preferences jsonb;
  archived boolean;
begin
  if (select is_archived from public.cars where id = vehicle) is distinct from false then
    raise exception 'Legacy/default vehicle must be active';
  end if;
  select to_jsonb(c) - 'is_archived' into before_car from public.cars c where id = vehicle;
  select to_jsonb(v) into before_visit from public.visits v where car_id = vehicle;
  select to_jsonb(s) into before_schedule from public.schedule_items s where car_id = vehicle;
  select to_jsonb(o) into before_photo from storage.objects o where name = '88888888-8888-4888-8888-888888888881/archive/receipt.webp';
  select to_jsonb(p) into before_preferences from public.notification_preferences p where user_id = auth.uid();
  foreach archived in array array[true, false] loop
    update public.cars set is_archived = archived where id = vehicle;
    if (select is_archived from public.cars where id = vehicle) is distinct from archived then
      raise exception 'Owner archive/restore failed';
    end if;
    if (select to_jsonb(c) - 'is_archived' from public.cars c where id = vehicle) is distinct from before_car
      or (select to_jsonb(v) from public.visits v where car_id = vehicle) is distinct from before_visit
      or (select to_jsonb(s) from public.schedule_items s where car_id = vehicle) is distinct from before_schedule
      or (select to_jsonb(o) from storage.objects o where name = '88888888-8888-4888-8888-888888888881/archive/receipt.webp') is distinct from before_photo
      or (select to_jsonb(p) from public.notification_preferences p where user_id = auth.uid()) is distinct from before_preferences then
      raise exception 'Archive changed related records, storage, preferences, or vehicle fields';
    end if;
  end loop;
  begin
    update public.cars set is_archived = null where id = vehicle;
    raise exception 'Null archive flag accepted';
  exception when not_null_violation then null; end;
  update public.cars set is_archived = true where id = vehicle;
  perform public.save_car(before_car || '{"name":"Stale active editor","is_archived":false}'::jsonb);
  if (select is_archived from public.cars where id = vehicle) is distinct from true then
    raise exception 'Ordinary stale edit restored an archived vehicle';
  end if;
  update public.cars set is_archived = false where id = vehicle;
  perform public.save_car(before_car || '{"is_archived":true}'::jsonb);
  if (select is_archived from public.cars where id = vehicle) is distinct from false then
    raise exception 'Ordinary stale edit archived a restored vehicle';
  end if;
  perform public.save_car(before_car || '{"id":"88888888-8888-4888-8888-888888888886","is_archived":true}'::jsonb);
  if (select is_archived from public.cars where id = '88888888-8888-4888-8888-888888888886') is distinct from true then
    raise exception 'Guest transfer could not create an archived vehicle';
  end if;
  update public.cars set is_archived = true where id = vehicle;
  update public.visits set notes = 'Late receipt' where car_id = vehicle;
  update public.schedule_items set source_note = 'Still editable' where car_id = vehicle;
  if (select notes from public.visits where car_id = vehicle) <> 'Late receipt' then
    raise exception 'Archived history not editable';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888882', true);
do $$ begin
  if exists (select from public.cars where id = '88888888-8888-4888-8888-888888888883') then
    raise exception 'Other owner can read archived vehicle';
  end if;
  update public.cars set is_archived = false where id = '88888888-8888-4888-8888-888888888883';
  if found then raise exception 'Other owner can restore vehicle'; end if;
  begin
    perform public.save_car('{"id":"88888888-8888-4888-8888-888888888883","user_id":"88888888-8888-4888-8888-888888888881"}');
    raise exception 'Other owner can save vehicle with spoofed ownership';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_car('{"id":"88888888-8888-4888-8888-888888888883","user_id":"88888888-8888-4888-8888-888888888882","name":"Cross-owner conflict","year":2020,"make":"Toyota","model":"RAV4","vin":"","plate":"","distance_unit":"miles","odometer":1,"reminder_days":30,"reminder_miles":500,"created_at":"2026-01-01","is_archived":false}');
    raise exception 'Other owner can upsert a conflicting vehicle ID';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if (select is_archived from public.cars where id = '88888888-8888-4888-8888-888888888883') is distinct from true then
    raise exception 'Owner isolation failed';
  end if;
end $$;
rollback;
