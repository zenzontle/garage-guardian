alter table public.cars
  add column distance_unit text not null default 'miles'
  check (distance_unit in ('miles', 'kilometers'));

comment on column public.cars.distance_unit is 'Chosen at vehicle creation. All vehicle, schedule, and visit distances use this unit.';
comment on column public.cars.reminder_miles is 'Upcoming distance window in the vehicle distance_unit; legacy column name retained.';
comment on column public.schedule_items.interval_miles is 'Recurring distance interval in the parent vehicle distance_unit; legacy column name retained.';
comment on column public.schedule_items.first_due_miles is 'First due odometer reading in the parent vehicle distance_unit; legacy column name retained.';
