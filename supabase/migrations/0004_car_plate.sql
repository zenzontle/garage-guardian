alter table public.cars
  add column plate text not null default ''
  constraint cars_plate_length check (char_length(plate) <= 20);

comment on column public.cars.plate is 'Optional free-text license plate. Empty means no plate; case, internal spaces, and punctuation are preserved.';
