-- Preserve unknown service readings without substituting zero.
alter table public.visits alter column odometer drop not null;
