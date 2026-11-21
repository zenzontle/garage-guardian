-- Apply before deploying clients that report fuel spending or record other costs.

-- Preserves conversions like preserve_visit_conversions (0010) for any receipt table. The
-- trigger argument names the table's date column.
create function public.preserve_receipt_conversions() returns trigger
language plpgsql set search_path = '' as $$
declare
  target text;
  c jsonb;
  retained jsonb := '{}'::jsonb;
  old_date date := (to_jsonb(old)->>tg_argv[0])::date;
  new_date date := (to_jsonb(new)->>tg_argv[0])::date;
begin
  if (new.currency, new_date, new.total_cost_cents) is not distinct from
     (old.currency, old_date, old.total_cost_cents) then
    -- Saved values win over stale automatic writes.
    retained := old.conversions;
    for target, c in select * from jsonb_each(new.conversions) loop
      if not (retained ? target) then
        retained := retained || jsonb_build_object(target, c);
      end if;
    end loop;
  else
    -- Only conversions made from the new inputs survive an edit.
    for target, c in select * from jsonb_each(new.conversions) loop
      if public.valid_visit_conversions(jsonb_build_object(target, c), new.currency, new_date,
        new.total_cost_cents) then
        retained := retained || jsonb_build_object(target, c);
      end if;
    end loop;
  end if;
  new.conversions := retained;
  return new;
end;
$$;

-- Fill-ups and other costs are converted only in the background, so conversions are automatic.
create function public.automatic_conversions(data jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(data) = 'object' then
    (select coalesce(bool_and(value->>'source' = 'automatic'), true) from jsonb_each(data))
  else false end;
$$;

-- Fill-up conversions to the home currency.
alter table public.fuel_entries add column conversions jsonb not null default '{}'::jsonb;
alter table public.fuel_entries add constraint valid_conversions check (
  public.valid_visit_conversions(conversions, currency, fuel_date, total_cost_cents)
  and public.automatic_conversions(conversions)
);
create trigger preserve_fuel_conversions before update on public.fuel_entries
  for each row execute function public.preserve_receipt_conversions('fuel_date');

-- Ownership costs other than service and fuel.
create table public.expenses (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  car_id uuid not null,
  expense_date date not null,
  category text not null check (category in ('insurance', 'registration', 'inspection', 'tax',
    'financing', 'parking', 'tolls', 'washing', 'other')),
  description text not null default '' check (char_length(description) <= 100),
  total_cost_cents integer not null check (total_cost_cents >= 0),
  currency text not null default 'USD' check (currency in ('USD', 'MXN', 'CAD')),
  conversions jsonb not null default '{}'::jsonb,
  -- When the cost is due again, such as an insurance policy's end date.
  renews_on date check (renews_on > expense_date),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  foreign key (car_id, user_id) references public.cars(id, user_id) on delete cascade,
  constraint valid_conversions check (
    public.valid_visit_conversions(conversions, currency, expense_date, total_cost_cents)
    and public.automatic_conversions(conversions)
  )
);

create index expenses_user_car_date_idx on public.expenses(user_id, car_id, expense_date desc);

alter table public.expenses enable row level security;
create policy "Owners manage expenses" on public.expenses for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.expenses from anon;
grant select, insert, update, delete on public.expenses to authenticated;

create trigger preserve_expense_conversions before update on public.expenses
  for each row execute function public.preserve_receipt_conversions('expense_date');

-- Background conversions, like save_visit_conversion: one conditional UPDATE holds the row lock
-- and rechecks the inputs after concurrent edits. RLS and auth.uid() scope it to the owner.
create function public.save_fuel_conversion(p_id uuid, p_currency text, p_date date,
  p_total integer, p_target text, p_conversion jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_target not in ('USD', 'MXN', 'CAD') or p_conversion->>'source' <> 'automatic' or
    not public.valid_visit_conversions(jsonb_build_object(p_target, p_conversion), p_currency,
      p_date, p_total) then
    raise exception 'Invalid conversion';
  end if;
  update public.fuel_entries set conversions = conversions || jsonb_build_object(p_target, p_conversion)
  where id = p_id and user_id = (select auth.uid()) and currency = p_currency
    and fuel_date = p_date and total_cost_cents = p_total and not (conversions ? p_target);
end;
$$;
revoke all on function public.save_fuel_conversion(uuid, text, date, integer, text, jsonb) from public;
grant execute on function public.save_fuel_conversion(uuid, text, date, integer, text, jsonb) to authenticated;

create function public.save_expense_conversion(p_id uuid, p_currency text, p_date date,
  p_total integer, p_target text, p_conversion jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_target not in ('USD', 'MXN', 'CAD') or p_conversion->>'source' <> 'automatic' or
    not public.valid_visit_conversions(jsonb_build_object(p_target, p_conversion), p_currency,
      p_date, p_total) then
    raise exception 'Invalid conversion';
  end if;
  update public.expenses set conversions = conversions || jsonb_build_object(p_target, p_conversion)
  where id = p_id and user_id = (select auth.uid()) and currency = p_currency
    and expense_date = p_date and total_cost_cents = p_total and not (conversions ? p_target);
end;
$$;
revoke all on function public.save_expense_conversion(uuid, text, date, integer, text, jsonb) from public;
grant execute on function public.save_expense_conversion(uuid, text, date, integer, text, jsonb) to authenticated;
