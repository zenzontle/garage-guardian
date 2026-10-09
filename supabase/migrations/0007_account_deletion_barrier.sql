-- RLS runs during Storage's permission probe, but upload completion uses an
-- elevated connection. Guard the actual INSERT/UPDATE, including those writes.
create function public.guard_account_photo_commit() returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
declare
  account_id uuid;
begin
  if new.bucket_id <> 'visit-photos' then return new; end if;
  -- A fresh snapshot after waiting for the row lock is required for the fence.
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'Photo writes require read committed isolation' using errcode = '40001';
  end if;
  begin
    account_id := split_part(new.name, '/', 1)::uuid;
  exception when invalid_text_representation then
    raise exception 'Invalid photo owner' using errcode = '42501';
  end;
  -- Held until this metadata transaction commits or rolls back. Auth deletion
  -- and fence insertion both conflict with this shared row lock.
  perform id from auth.users where id = account_id for share;
  if not found then
    raise exception 'Photo owner no longer exists' using errcode = '42501';
  end if;
  if exists (select 1 from public.account_deletion_locks where user_id = account_id) then
    raise exception 'Account photo writes are paused' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_account_photo_commit() from public, anon, authenticated;
create trigger guard_account_photo_commit
before insert or update on storage.objects
for each row execute function public.guard_account_photo_commit();

-- Keep the existing server-only upsert contract. This also protects an older
-- endpoint during rollout: every fence write must drain earlier photo commits.
create function public.guard_account_deletion_start() returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'Account deletion requires read committed isolation' using errcode = '40001';
  end if;
  perform id from auth.users where id = new.user_id for update;
  if not found then
    raise exception 'Account no longer exists' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_account_deletion_start() from public, anon, authenticated;
create trigger guard_account_deletion_start
before insert or update on public.account_deletion_locks
for each row execute function public.guard_account_deletion_start();
