-- Run as postgres/admin after all migrations and the catalog seed. Fixtures roll back.
begin;

do $$
declare role_name text; table_name text; privilege text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    foreach table_name in array array['vehicle_makes', 'vehicle_models'] loop
      if not has_table_privilege(role_name, 'public.' || table_name, 'SELECT') then
        raise exception '% cannot SELECT %', role_name, table_name;
      end if;
      foreach privilege in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if has_table_privilege(role_name, 'public.' || table_name, privilege) then
          raise exception '% has unexpected % on %', role_name, privilege, table_name;
        end if;
      end loop;
      if not (select relrowsecurity from pg_class where oid = ('public.' || table_name)::regclass) then
        raise exception 'RLS disabled on %', table_name;
      end if;
    end loop;
  end loop;
end $$;

-- Baseline counts are captured as admin so RLS cannot hide missing catalog rows.
select set_config('zen5.make_count', (select count(*)::text from public.vehicle_makes), true);
select set_config('zen5.model_count', (select count(*)::text from public.vehicle_models), true);
do $$ begin
  if current_setting('zen5.make_count')::int = 0 or current_setting('zen5.model_count')::int = 0 then
    raise exception 'Apply the catalog seed before verifying';
  end if;
end $$;

-- Two throwaway owners exercise the existing car policy without catalog FKs.
insert into auth.users (id) values
  ('55555555-5555-4555-8555-555555555551'), ('55555555-5555-4555-8555-555555555552');
insert into public.cars (id, user_id, name, year, make, model, odometer) values
  ('55555555-5555-4555-8555-555555555553', '55555555-5555-4555-8555-555555555551', 'ZEN-5 owner', 2020, 'Unknown', 'Custom', 0),
  ('55555555-5555-4555-8555-555555555554', '55555555-5555-4555-8555-555555555552', 'ZEN-5 other', 2020, 'Toyota', 'Civic', 0);

set local role anon;
do $$ begin
  if (select count(*) from public.vehicle_makes) <> current_setting('zen5.make_count')::int
    or (select count(*) from public.vehicle_models) <> current_setting('zen5.model_count')::int then
    raise exception 'Anonymous catalog read is incomplete';
  end if;
  begin
    insert into public.vehicle_makes (lookup_key, display_name) values ('zen5-invalid', 'ZEN-5');
    raise exception 'Anonymous catalog write unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    if exists (select 1 from public.cars where id in ('55555555-5555-4555-8555-555555555553', '55555555-5555-4555-8555-555555555554')) then
      raise exception 'Anonymous client read private cars';
    end if;
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555551', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.vehicle_makes) <> current_setting('zen5.make_count')::int
    or (select count(*) from public.vehicle_models) <> current_setting('zen5.model_count')::int then
    raise exception 'Authenticated catalog read is incomplete';
  end if;
  begin
    update public.vehicle_models set display_name = 'ZEN-5';
    raise exception 'Authenticated catalog write unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  if not exists (select 1 from public.cars where id = '55555555-5555-4555-8555-555555555553') then
    raise exception 'Owner cannot read own car';
  end if;
  if exists (select 1 from public.cars where id = '55555555-5555-4555-8555-555555555554') then
    raise exception 'Owner can read another owner car';
  end if;
  update public.cars set model = 'Unlisted model' where id = '55555555-5555-4555-8555-555555555553';
  if not found then raise exception 'Owner cannot update own free-text car'; end if;
  update public.cars set model = 'Disallowed' where id = '55555555-5555-4555-8555-555555555554';
  if found then raise exception 'Owner can update another owner car'; end if;
end $$;
reset role;
rollback;
