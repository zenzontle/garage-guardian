create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  weekday integer not null default 1 check (weekday between 0 and 6),
  email_language text not null default 'en' check (email_language in ('en', 'es')),
  consent_at timestamptz,
  next_scheduled_at timestamptz,
  check (enabled = (next_scheduled_at is not null))
);
create index notification_preferences_schedule_idx
  on public.notification_preferences (next_scheduled_at, user_id) where enabled;
alter table public.notification_preferences enable row level security;
create policy "Owners read preferences" on public.notification_preferences
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Owners create preferences" on public.notification_preferences
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Owners update preferences" on public.notification_preferences
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on public.notification_preferences from anon, authenticated;
grant select on public.notification_preferences to authenticated;
grant insert (user_id, enabled, weekday, email_language), update (enabled, weekday, email_language)
  on public.notification_preferences to authenticated;
grant all on public.notification_preferences to service_role;

-- Strictly future occurrence, always at 16:00 UTC (Sunday = 0).
create function public.next_reminder_date(p_weekday integer, p_after timestamptz)
returns timestamptz language sql immutable set search_path = '' as $$
  select candidate + case when candidate <= p_after then interval '7 days' else interval '0' end
  from (
    select ((p_after at time zone 'UTC')::date
      + ((p_weekday - extract(dow from p_after at time zone 'UTC')::integer + 7) % 7)
      + time '16:00') at time zone 'UTC' as candidate
  ) dates;
$$;

create function public.schedule_notification_preferences()
returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    new.consent_at := case when new.enabled then now() else null end;
    new.next_scheduled_at := case when new.enabled then public.next_reminder_date(new.weekday, now()) else null end;
  elsif not new.enabled then
    new.next_scheduled_at := null;
  elsif not old.enabled or new.weekday <> old.weekday then
    new.next_scheduled_at := public.next_reminder_date(new.weekday, now());
    if not old.enabled then new.consent_at := now(); end if;
  end if;
  return new;
end;
$$;
create trigger schedule_notification_preferences
  before insert or update on public.notification_preferences
  for each row execute function public.schedule_notification_preferences();

-- Keep historical claims without implying their default sent_at proved delivery.
alter table public.reminder_deliveries
  add column status text not null default 'unknown'
    check (status in ('processing', 'accepted', 'failed', 'unknown', 'skipped')),
  add column attempted_at timestamptz,
  add column completed_at timestamptz,
  add column item_count integer not null default 0 check (item_count >= 0),
  add column provider_message_id text,
  add column failure_code text;
update public.reminder_deliveries
  set attempted_at = sent_at, failure_code = 'legacy_unverified';
alter table public.reminder_deliveries
  alter column attempted_at set not null,
  alter column attempted_at set default now(),
  alter column sent_at drop not null,
  alter column sent_at drop default;
update public.reminder_deliveries set sent_at = null;
create index reminder_deliveries_attempted_idx on public.reminder_deliveries (attempted_at);
revoke all on public.reminder_deliveries from anon, authenticated;
grant all on public.reminder_deliveries to service_role;

-- A claim and advancing its schedule are one transaction. Only the worker may call it.
create function public.claim_reminder(p_user_id uuid)
returns date language plpgsql security definer set search_path = '' as $$
declare
  preferences public.notification_preferences;
  week date := date_trunc('week', now() at time zone 'UTC')::date;
  claimed date;
begin
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
