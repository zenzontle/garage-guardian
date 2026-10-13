-- Keep a new/edited interval-only task's upsert and baseline initialization in one transaction.
create function public.save_schedule_with_defaults(p_user_id uuid, p_item jsonb, p_today date)
returns setof public.schedule_items
language plpgsql security invoker set search_path = '' as $$
declare
  item public.schedule_items := jsonb_populate_record(null::public.schedule_items, p_item);
begin
  if item.user_id is distinct from p_user_id then
    raise exception 'Schedule owner does not match' using errcode = '23514';
  end if;
  -- Acquire the same parent lock as the initializer before the upsert's foreign-key check.
  perform id from public.cars where id = item.car_id and user_id = p_user_id for update;
  if not found then raise exception 'Car not found' using errcode = '23503'; end if;

  insert into public.schedule_items (
    id, user_id, car_id, name, interval_miles, interval_months,
    first_due_miles, first_due_date, source_note, is_active, created_at
  ) values (
    item.id, item.user_id, item.car_id, item.name, item.interval_miles, item.interval_months,
    item.first_due_miles, item.first_due_date, item.source_note, item.is_active, item.created_at
  ) on conflict (id) do update set
    car_id = excluded.car_id,
    name = excluded.name,
    interval_miles = excluded.interval_miles,
    interval_months = excluded.interval_months,
    first_due_miles = excluded.first_due_miles,
    first_due_date = excluded.first_due_date,
    source_note = excluded.source_note,
    is_active = excluded.is_active,
    created_at = excluded.created_at;

  return query select * from public.initialize_schedule_defaults(
    p_user_id, item.id, item.car_id, item.interval_miles, item.interval_months, p_today);
end;
$$;
revoke all on function public.save_schedule_with_defaults(uuid, jsonb, date) from public, anon;
grant execute on function public.save_schedule_with_defaults(uuid, jsonb, date)
  to authenticated, service_role;
