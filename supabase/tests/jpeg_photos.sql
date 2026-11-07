-- Run as postgres/admin after migration 0013. Read-only.
do $$
declare
  bucket storage.buckets;
begin
  select * into bucket from storage.buckets where id = 'visit-photos';
  if bucket.allowed_mime_types is distinct from array['image/webp', 'image/jpeg'] then
    raise exception 'visit-photos must allow exactly WebP and JPEG, got %', bucket.allowed_mime_types;
  end if;
  if bucket.public or bucket.file_size_limit is distinct from 2000000 then
    raise exception 'visit-photos must stay private with a 2 MB limit';
  end if;
end $$;
