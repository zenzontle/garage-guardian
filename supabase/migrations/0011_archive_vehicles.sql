-- Apply before deploying clients that read or write vehicle archive state.
alter table public.cars add column is_archived boolean not null default false;

-- Ordinary edits cannot undo a concurrent archive/restore from another tab or device.
create function public.save_car(p_car jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  vehicle public.cars := jsonb_populate_record(null::public.cars, p_car);
begin
  if auth.uid() is null or vehicle.user_id is distinct from auth.uid() then
    raise exception 'Vehicle owner does not match' using errcode = '42501';
  end if;
  insert into public.cars (
    id, user_id, name, year, make, model, vin, plate, distance_unit,
    odometer, reminder_days, reminder_miles, created_at, is_archived
  ) values (
    vehicle.id, vehicle.user_id, vehicle.name, vehicle.year, vehicle.make, vehicle.model,
    vehicle.vin, vehicle.plate, vehicle.distance_unit, vehicle.odometer,
    vehicle.reminder_days, vehicle.reminder_miles, vehicle.created_at, coalesce(vehicle.is_archived, false)
  ) on conflict (id) do update set
    name = excluded.name,
    year = excluded.year,
    make = excluded.make,
    model = excluded.model,
    vin = excluded.vin,
    plate = excluded.plate,
    distance_unit = excluded.distance_unit,
    odometer = excluded.odometer,
    reminder_days = excluded.reminder_days,
    reminder_miles = excluded.reminder_miles;
end;
$$;
revoke all on function public.save_car(jsonb) from public, anon;
grant execute on function public.save_car(jsonb) to authenticated;
