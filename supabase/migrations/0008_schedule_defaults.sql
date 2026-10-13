-- Read the baseline and persist defaults in one transaction. RLS remains in force for clients.
create function public.initialize_schedule_defaults(
  p_user_id uuid,
  p_schedule_id uuid,
  p_car_id uuid,
  p_interval_miles integer,
  p_interval_months integer,
  p_today date
)
returns setof public.schedule_items
language plpgsql security invoker set search_path = '' as $$
declare
  item public.schedule_items;
  reading integer;
begin
  if p_today is null then raise exception 'A baseline date is required'; end if;

  -- FOR UPDATE also blocks new visits' foreign-key checks until this transaction commits.
  select odometer into reading from public.cars
    where id = p_car_id and user_id = p_user_id for update;
  select * into item from public.schedule_items
    where id = p_schedule_id and user_id = p_user_id for update;
  if not found then return; end if;

  if reading is not null and item.car_id = p_car_id and item.is_active
    and item.first_due_miles is null and item.first_due_date is null
    and item.interval_miles is not distinct from p_interval_miles
    and item.interval_months is not distinct from p_interval_months
    and (item.interval_miles is not null or item.interval_months is not null) then
    -- Lock existing visits against updates/deletes before reading their odometers.
    perform id from public.visits
      where car_id = p_car_id and user_id = p_user_id order by id for update;
    select greatest(reading, coalesce(max(odometer), reading)) into reading from public.visits
      where car_id = p_car_id and user_id = p_user_id;
    update public.schedule_items set
      first_due_miles = case when item.interval_miles is null then null
        else (greatest(1, ceil(reading::numeric / item.interval_miles)) * item.interval_miles)::integer end,
      first_due_date = case when item.interval_months is null then null
        else (p_today + make_interval(months => item.interval_months))::date end
      where id = item.id and user_id = p_user_id returning * into item;
  end if;
  -- Return edits/deactivation unchanged; a deleted or inaccessible row returns no records.
  return next item;
end;
$$;
revoke all on function public.initialize_schedule_defaults(uuid, uuid, uuid, integer, integer, date)
  from public, anon;
grant execute on function public.initialize_schedule_defaults(uuid, uuid, uuid, integer, integer, date)
  to authenticated, service_role;
