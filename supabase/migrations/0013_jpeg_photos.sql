-- Safari cannot encode WebP from a canvas, so photos prepared there are JPEG.
-- Apply before deploying clients that upload JPEG photos.
update storage.buckets
set allowed_mime_types = array['image/webp', 'image/jpeg']
where id = 'visit-photos';
