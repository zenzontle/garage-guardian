-- Apply before deploying the account deletion endpoint and worker.
-- Each row is a durable order to delete one account and all of its data. The API enqueues it
-- after reauthentication and tries to finish it immediately; /api/account-deletions retries it.
-- Deleting the auth user cascades to every owner table, including this one, so a completed
-- order leaves no row behind.
create table public.account_deletion_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  -- A worker lease: unexpired claims are skipped by other workers.
  locked_until timestamptz,
  failure_code text check (char_length(failure_code) <= 64)
);
create index account_deletion_requests_queue_idx
  on public.account_deletion_requests (requested_at, user_id);
alter table public.account_deletion_requests enable row level security;
-- Server-only: no policies, and no client grants.
revoke all on public.account_deletion_requests from anon, authenticated;
grant all on public.account_deletion_requests to service_role;

-- Enqueue (idempotently) and stop weekly digests in the same transaction.
create function public.request_account_deletion(p_user_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  requested timestamptz;
begin
  insert into public.account_deletion_requests (user_id) values (p_user_id)
    on conflict (user_id) do update set user_id = excluded.user_id
    returning requested_at into requested;
  update public.notification_preferences set enabled = false
    where user_id = p_user_id and enabled;
  return requested;
end;
$$;
revoke all on function public.request_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.request_account_deletion(uuid) to service_role;

-- Lease up to p_limit (at most 100) unclaimed orders, oldest first, or only p_user_id's.
-- The two-minute lease outlasts the 60-second function limit of the API and worker.
create function public.claim_account_deletions(p_limit integer, p_user_id uuid default null)
returns table (user_id uuid) language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.account_deletion_requests as request
    set attempts = request.attempts + 1,
        last_attempt_at = now(),
        locked_until = now() + interval '2 minutes'
    where request.user_id in (
      select queued.user_id from public.account_deletion_requests as queued
      where (p_user_id is null or queued.user_id = p_user_id)
        and (queued.locked_until is null or queued.locked_until <= now())
      order by queued.requested_at, queued.user_id
      limit least(greatest(coalesce(p_limit, 0), 0), 100)
      for update skip locked
    )
    returning request.user_id;
end;
$$;
revoke all on function public.claim_account_deletions(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_account_deletions(integer, uuid) to service_role;

-- Storage objects must be removed through the Storage API (which also deletes the files),
-- and Supabase refuses to delete an auth user who still owns objects. The worker pages
-- through the account's photo folder with this function and removes each page.
create function public.account_photo_paths(p_user_id uuid, p_limit integer)
returns table (name text) language sql stable security definer set search_path = '' as $$
  select photo.name from storage.objects as photo
  where photo.bucket_id = 'visit-photos'
    and photo.name like p_user_id::text || '/%'
  order by photo.name
  limit least(greatest(coalesce(p_limit, 0), 0), 1000);
$$;
revoke all on function public.account_photo_paths(uuid, integer) from public, anon, authenticated;
grant execute on function public.account_photo_paths(uuid, integer) to service_role;

-- Database rows cannot outlive their auth user (foreign keys), but a still-valid access token
-- could otherwise upload a photo after the worker listed the folder or deleted the user.
create function public.account_accepts_uploads()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users where id = (select auth.uid()))
    and not exists (
      select 1 from public.account_deletion_requests where user_id = (select auth.uid())
    );
$$;
revoke all on function public.account_accepts_uploads() from public, anon;
grant execute on function public.account_accepts_uploads() to authenticated;

create policy "Accounts being deleted cannot upload photos" on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'visit-photos' or public.account_accepts_uploads());
create policy "Accounts being deleted cannot replace photos" on storage.objects
  as restrictive for update to authenticated
  with check (bucket_id <> 'visit-photos' or public.account_accepts_uploads());

-- Same as 0007, but an account with a queued deletion order is never claimed. Its reminders
-- are disabled when the order is recorded; an access token issued before the request could
-- still re-enable them until the order completes.
create or replace function public.claim_reminder(p_user_id uuid)
returns date language plpgsql security definer set search_path = '' as $$
declare
  preferences public.notification_preferences;
  week date := date_trunc('week', now() at time zone 'UTC')::date;
  claimed date;
begin
  if exists (select 1 from public.account_deletion_requests where user_id = p_user_id) then
    return null;
  end if;
  select * into preferences from public.notification_preferences
    where user_id = p_user_id for update;
  if not found or not preferences.enabled or preferences.next_scheduled_at > now() then
    return null;
  end if;
  insert into public.reminder_deliveries (user_id, week_start, status)
    values (p_user_id, week, 'processing')
    on conflict do nothing returning week_start into claimed;
  update public.notification_preferences
    set next_scheduled_at = public.next_reminder_date(weekday, now())
    where user_id = p_user_id;
  return claimed;
end;
$$;
revoke all on function public.claim_reminder(uuid) from public, anon, authenticated;
grant execute on function public.claim_reminder(uuid) to service_role;
