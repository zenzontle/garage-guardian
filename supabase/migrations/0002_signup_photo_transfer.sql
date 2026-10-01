-- A signup transfer retries the same account-owned photo paths after interruptions.
create policy "Owners update their photos" on storage.objects for update to authenticated
using (bucket_id = 'visit-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'visit-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
