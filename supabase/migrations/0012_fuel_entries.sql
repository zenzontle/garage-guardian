-- Apply before deploying clients that read or write fill-ups.
create table public.fuel_entries (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  car_id uuid not null,
  fuel_date date not null,
  odometer integer not null check (odometer >= 0),
  -- Thousandths of a gallon or liter, and thousandths of the currency per unit.
  volume_milli integer not null check (volume_milli > 0 and volume_milli <= 2000000),
  volume_unit text not null check (volume_unit in ('gallons', 'liters')),
  fuel_type text not null check (fuel_type in ('regular', 'midgrade', 'premium', 'diesel', 'e85', 'other')),
  unit_price_milli integer not null check (unit_price_milli >= 0),
  total_cost_cents integer not null check (total_cost_cents >= 0),
  currency text not null default 'USD' check (currency in ('USD', 'MXN', 'CAD')),
  is_full_tank boolean not null default true,
  missed_previous boolean not null default false,
  station text not null default '' check (char_length(station) <= 100),
  notes text not null default '' check (char_length(notes) <= 2000),
  photos jsonb not null default '[]'::jsonb
    check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 3),
  created_at timestamptz not null default now(),
  foreign key (car_id, user_id) references public.cars(id, user_id) on delete cascade
);

create index fuel_entries_user_car_date_idx on public.fuel_entries(user_id, car_id, fuel_date desc);

alter table public.fuel_entries enable row level security;
create policy "Owners manage fuel entries" on public.fuel_entries for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.fuel_entries from anon;
grant select, insert, update, delete on public.fuel_entries to authenticated;
-- The reminder worker reads fill-up odometers, and its baseline RPC locks them FOR UPDATE.
grant select, update on public.fuel_entries to service_role;

-- Same baseline as 0008, now also counting fill-up readings, so the first due distance the
-- cloud stores matches the one browsers compute from the latest entered odometer.
create or replace function public.initialize_schedule_defaults(
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

  -- FOR UPDATE also blocks new visits' and fill-ups' foreign-key checks until this commits.
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
    -- Lock existing visits and fill-ups against updates/deletes before reading their odometers.
    perform id from public.visits
      where car_id = p_car_id and user_id = p_user_id order by id for update;
    perform id from public.fuel_entries
      where car_id = p_car_id and user_id = p_user_id order by id for update;
    select greatest(reading, coalesce(max(odometer), reading)) into reading from public.visits
      where car_id = p_car_id and user_id = p_user_id;
    select greatest(reading, coalesce(max(odometer), reading)) into reading from public.fuel_entries
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
