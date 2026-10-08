-- Server-only durable fence. A failed cleanup keeps uploads paused until deletion is retried.
create table public.account_deletion_locks (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.account_deletion_locks enable row level security;
revoke all on public.account_deletion_locks from anon, authenticated;
grant all on public.account_deletion_locks to service_role;

create function public.account_can_write_photos() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from auth.users where id = (select auth.uid()))
    and not exists (select 1 from public.account_deletion_locks where user_id = (select auth.uid()));
$$;
revoke all on function public.account_can_write_photos() from public, anon;
grant execute on function public.account_can_write_photos() to authenticated;

alter policy "Owners upload their photos" on storage.objects
with check (bucket_id = 'visit-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.account_can_write_photos()));
alter policy "Owners update their photos" on storage.objects
using (bucket_id = 'visit-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.account_can_write_photos()))
with check (bucket_id = 'visit-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.account_can_write_photos()));
