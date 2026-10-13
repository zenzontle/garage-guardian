-- Run as postgres/admin after migration 0007. All fixtures roll back.
begin;

insert into auth.users (id) values
  ('77777777-7777-4777-8777-777777777771'),
  ('77777777-7777-4777-8777-777777777772');

do $$
declare weekday integer; result timestamptz;
begin
  for weekday in 0..6 loop
    result := public.next_reminder_date(weekday, '2026-12-31 17:00:00+00');
    if result <= '2026-12-31 17:00:00+00'::timestamptz
      or result > '2027-01-07 17:00:00+00'::timestamptz
      or extract(dow from result at time zone 'UTC') <> weekday
      or (result at time zone 'UTC')::time <> time '16:00' then
      raise exception 'Invalid schedule for weekday %', weekday;
    end if;
  end loop;
  if public.next_reminder_date(1, '2026-10-05 15:59:59+00') <> '2026-10-05 16:00:00+00'::timestamptz
    or public.next_reminder_date(1, '2026-10-05 16:00:00+00') <> '2026-10-12 16:00:00+00'::timestamptz then
    raise exception 'Schedule must be strictly future';
  end if;
  if exists (select 1 from public.notification_preferences where user_id::text like '77777777-%') then
    raise exception 'Accounts must not be automatically enrolled';
  end if;
  if has_table_privilege('authenticated', 'public.reminder_deliveries', 'SELECT')
    or has_function_privilege('authenticated', 'public.claim_reminder(uuid)', 'EXECUTE')
    or has_column_privilege('authenticated', 'public.notification_preferences', 'next_scheduled_at', 'UPDATE')
    or has_column_privilege('authenticated', 'public.notification_preferences', 'consent_at', 'INSERT') then
    raise exception 'Client can access server-owned delivery state';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777771', true);
insert into public.notification_preferences (user_id, weekday, email_language)
  values ('77777777-7777-4777-8777-777777777771', 1, 'es');
do $$ begin
  if (select enabled or consent_at is not null or next_scheduled_at is not null
      from public.notification_preferences) then raise exception 'Defaults must be disabled'; end if;
  begin
    insert into public.notification_preferences (user_id)
      values ('77777777-7777-4777-8777-777777777772');
    raise exception 'Cross-account insert succeeded';
  exception when insufficient_privilege then null; end;
  begin
    update public.notification_preferences set next_scheduled_at = now();
    raise exception 'Client changed schedule';
  exception when insufficient_privilege then null; end;
end $$;
update public.notification_preferences set enabled = true;
do $$ begin
  if (select consent_at is null or next_scheduled_at <= now() from public.notification_preferences) then
    raise exception 'Opt-in did not schedule or record consent';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777772', true);
do $$ begin
  if exists (select 1 from public.notification_preferences) then raise exception 'Cross-account read'; end if;
  update public.notification_preferences set enabled = false
    where user_id = '77777777-7777-4777-8777-777777777771';
  if found then raise exception 'Cross-account update'; end if;
end $$;
insert into public.notification_preferences (user_id, enabled, weekday, email_language)
  values ('77777777-7777-4777-8777-777777777772', true, 5, 'en');
update public.notification_preferences set enabled = false;
do $$ begin
  if (select next_scheduled_at is not null from public.notification_preferences) then
    raise exception 'Opt-out did not clear schedule';
  end if;
end $$;

reset role;
-- Force an overdue schedule as an administrator to simulate missed cron runs.
update public.notification_preferences set next_scheduled_at = now() - interval '30 days'
  where user_id = '77777777-7777-4777-8777-777777777771';
set local role service_role;
do $$
declare claimed date;
begin
  claimed := public.claim_reminder('77777777-7777-4777-8777-777777777771');
  if claimed is distinct from date_trunc('week', now() at time zone 'UTC')::date then
    raise exception 'Claim did not collapse missed weeks';
  end if;
  if public.claim_reminder('77777777-7777-4777-8777-777777777771') is not null then
    raise exception 'Repeated claim succeeded';
  end if;
  if public.claim_reminder('77777777-7777-4777-8777-777777777772') is not null then
    raise exception 'Disabled account claimed';
  end if;
  update public.notification_preferences set weekday = 3
    where user_id = '77777777-7777-4777-8777-777777777771';
  if (select next_scheduled_at from public.notification_preferences
      where user_id = '77777777-7777-4777-8777-777777777771')
    <> public.next_reminder_date(3, now()) then raise exception 'Weekday change not rescheduled'; end if;
  update public.notification_preferences set next_scheduled_at = now() - interval '1 day'
    where user_id = '77777777-7777-4777-8777-777777777771';
  if public.claim_reminder('77777777-7777-4777-8777-777777777771') is not null then
    raise exception 'Changing weekday allowed a second digest this week';
  end if;
  if (select count(*) from public.reminder_deliveries where user_id = '77777777-7777-4777-8777-777777777771') <> 1 then
    raise exception 'Duplicate digest';
  end if;
end $$;
reset role;
delete from auth.users where id::text in ('77777777-7777-4777-8777-777777777771', '77777777-7777-4777-8777-777777777772');
do $$ begin
  if exists (select 1 from public.notification_preferences where user_id::text like '77777777-%')
    or exists (select 1 from public.reminder_deliveries where user_id::text like '77777777-%') then
    raise exception 'Account deletion did not cascade';
  end if;
end $$;
rollback;
