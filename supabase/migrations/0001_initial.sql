create table public.cars (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  year integer not null check (year between 1980 and 2100),
  make text not null check (length(trim(make)) between 1 and 50),
  model text not null check (length(trim(model)) between 1 and 50),
  vin text not null default '' check (length(vin) <= 17),
  odometer integer not null check (odometer >= 0),
  reminder_days integer not null default 30 check (reminder_days between 0 and 365),
  reminder_miles integer not null default 500 check (reminder_miles between 0 and 10000),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.schedule_items (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  car_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 80),
  interval_miles integer check (interval_miles > 0),
  interval_months integer check (interval_months > 0),
  first_due_miles integer check (first_due_miles >= 0),
  first_due_date date,
  source_note text not null default '' check (length(source_note) <= 180),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (car_id, user_id) references public.cars(id, user_id) on delete cascade
);

create table public.visits (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  car_id uuid not null,
  service_date date not null,
  odometer integer not null check (odometer >= 0),
  total_cost_cents integer not null check (total_cost_cents >= 0),
  provider text not null default '' check (length(provider) <= 100),
  notes text not null default '' check (length(notes) <= 2000),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  photos jsonb not null default '[]'::jsonb check (jsonb_typeof(photos) = 'array'),
  created_at timestamptz not null default now(),
  foreign key (car_id, user_id) references public.cars(id, user_id) on delete cascade
);

create index schedule_items_user_car_idx on public.schedule_items(user_id, car_id);
create index visits_user_car_date_idx on public.visits(user_id, car_id, service_date desc);

alter table public.cars enable row level security;
alter table public.schedule_items enable row level security;
alter table public.visits enable row level security;

create policy "Owners manage cars" on public.cars for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Owners manage schedules" on public.schedule_items for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Owners manage visits" on public.visits for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visit-photos', 'visit-photos', false, 2000000, array['image/webp'])
on conflict (id) do nothing;

create policy "Owners read their photos" on storage.objects for select to authenticated
using (bucket_id = 'visit-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Owners upload their photos" on storage.objects for insert to authenticated
with check (bucket_id = 'visit-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Owners delete their photos" on storage.objects for delete to authenticated
using (bucket_id = 'visit-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create table public.reminder_deliveries (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, week_start)
);
alter table public.reminder_deliveries enable row level security;
