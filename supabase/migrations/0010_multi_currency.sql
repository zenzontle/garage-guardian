-- Apply before deploying the multi-currency application.
create table public.garage_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  home_currency text not null default 'USD' check (home_currency in ('USD', 'MXN', 'CAD'))
);
alter table public.garage_settings enable row level security;
create policy "Owners manage garage settings" on public.garage_settings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.garage_settings to authenticated;

alter table public.visits add column currency text not null default 'USD'
  check (currency in ('USD', 'MXN', 'CAD'));
alter table public.visits add column conversions jsonb not null default '{}'::jsonb;

create function public.valid_visit_conversions(data jsonb, receipt_currency text, receipt_date date, total integer)
returns boolean language plpgsql immutable set search_path = '' as $$
declare target text; c jsonb; cents numeric; rate numeric;
begin
  if jsonb_typeof(data) is distinct from 'object' then return false; end if;
  for target, c in select * from jsonb_each(data) loop
    if target not in ('USD', 'MXN', 'CAD') or target = receipt_currency or
      jsonb_typeof(c) is distinct from 'object' or
      (c->>'currency') is distinct from receipt_currency or
      (c->>'date') is distinct from receipt_date::text or
      jsonb_typeof(c->'totalCostCents') is distinct from 'number' or
      (c->>'totalCostCents')::numeric is distinct from total::numeric or
      jsonb_typeof(c->'convertedCents') is distinct from 'number' then return false; end if;
    cents := (c->>'convertedCents')::numeric;
    if cents < 0 or cents > 2147483647 or cents <> trunc(cents) then return false; end if;
    if c->>'source' = 'manual' then
      if (c->'rate') is distinct from 'null'::jsonb or (c->'rateDate') is distinct from 'null'::jsonb then return false; end if;
    elsif c->>'source' = 'automatic' then
      if jsonb_typeof(c->'rate') is distinct from 'number' or
        jsonb_typeof(c->'rateDate') is distinct from 'string' or
        (c->>'rateDate') !~ '^\d{4}-\d{2}-\d{2}$' or
        (c->>'rateDate')::date > receipt_date then return false; end if;
      rate := (c->>'rate')::numeric;
      if rate <= 0 or round(total * rate) <> cents then return false; end if;
    else return false;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;
alter table public.visits add constraint valid_conversions
  check (public.valid_visit_conversions(conversions, currency, service_date, total_cost_cents));

create function public.preserve_visit_conversions() returns trigger
language plpgsql set search_path = '' as $$
declare target text; c jsonb; retained jsonb := '{}'::jsonb;
begin
  if (new.currency, new.service_date, new.total_cost_cents) is not distinct from
     (old.currency, old.service_date, old.total_cost_cents) then
    -- Frozen values win over stale automatic writes. Only explicit manual entry can replace them.
    retained := old.conversions;
    for target, c in select * from jsonb_each(new.conversions) loop
      if not (retained ? target) or c->>'source' = 'manual' then
        retained := retained || jsonb_build_object(target, c);
      end if;
    end loop;
  else
    -- Only conversions made from the new inputs survive an edit.
    for target, c in select * from jsonb_each(new.conversions) loop
      if public.valid_visit_conversions(jsonb_build_object(target, c), new.currency, new.service_date, new.total_cost_cents) then
        retained := retained || jsonb_build_object(target, c);
      end if;
    end loop;
  end if;
  new.conversions := retained;
  return new;
end;
$$;
create trigger preserve_visit_conversions before update on public.visits
  for each row execute function public.preserve_visit_conversions();

-- One conditional UPDATE holds the row lock and rechecks inputs after concurrent edits.
-- RLS and auth.uid() both scope the write to the calling owner.
create function public.save_visit_conversion(p_visit_id uuid, p_currency text, p_date date,
  p_total integer, p_target text, p_conversion jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_target not in ('USD', 'MXN', 'CAD') or not public.valid_visit_conversions(
    jsonb_build_object(p_target, p_conversion), p_currency, p_date, p_total) then
    raise exception 'Invalid conversion';
  end if;
  update public.visits set conversions = conversions || jsonb_build_object(p_target, p_conversion)
  where id = p_visit_id and user_id = (select auth.uid()) and currency = p_currency
    and service_date = p_date and total_cost_cents = p_total and not (conversions ? p_target);
end;
$$;
revoke all on function public.save_visit_conversion(uuid, text, date, integer, text, jsonb) from public;
grant execute on function public.save_visit_conversion(uuid, text, date, integer, text, jsonb) to authenticated;
