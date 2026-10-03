-- Public reference data; cars continue to store independent free-text values.
create table public.vehicle_makes (
  id uuid primary key default gen_random_uuid(),
  lookup_key text not null unique check (length(lookup_key) between 1 and 50),
  display_name text not null check (length(trim(display_name)) between 1 and 50)
);

create table public.vehicle_models (
  id uuid primary key default gen_random_uuid(),
  make_id uuid not null references public.vehicle_makes(id) on delete cascade,
  lookup_key text not null check (length(lookup_key) between 1 and 50),
  display_name text not null check (length(trim(display_name)) between 1 and 50),
  unique (make_id, lookup_key)
);
-- Unique indexes cover make lookups and model lookup/pagination by make_id.
alter table public.vehicle_makes enable row level security;
alter table public.vehicle_models enable row level security;

revoke all on public.vehicle_makes, public.vehicle_models from public, anon, authenticated;
grant select on public.vehicle_makes, public.vehicle_models to anon, authenticated;
grant all on public.vehicle_makes, public.vehicle_models to service_role;

create policy "Public reads vehicle makes" on public.vehicle_makes
  for select to anon, authenticated using (true);
create policy "Public reads vehicle models" on public.vehicle_models
  for select to anon, authenticated using (true);
