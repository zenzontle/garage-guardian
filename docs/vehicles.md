# Vehicles

## Distance units

Choose **Miles** (default) or **Kilometers** when adding a car. The distance unit is read-only in **Edit car**. Odometer readings, maintenance intervals, and service history use that vehicle’s chosen unit. Each car starts with a 30-day upcoming window and a distance window of **500 miles** or **1,000 kilometers**, adjustable in **Edit car**. Distance reminders use the latest entered odometer rather than an estimate. Existing vehicles remain Miles with their saved readings and reminder settings unchanged. CSV exports include a numeric Odometer column and a per-row Distance unit (`mi` or `km`).

In the database, all distance fields (including legacy `*_miles` columns) use the parent vehicle’s unit. The app writes the 500-mile or 1,000-kilometer reminder default explicitly. Migration `0003_vehicle_distance_units.sql` adds the unit with a Miles default.

## License plate

Each car can have an optional **License plate**, shown in its detail header when present. Add, edit, or clear it alongside VIN. Plates are free text up to **20 characters** after trimming leading and trailing whitespace; case, internal spaces, and punctuation are preserved. Blank input means no plate. No country-specific format, uniqueness rule, registration jurisdiction, or plate lookup is used. Older records load with no plate, and signup transfers preserve saved plates, including interrupted transfers resumed after a reload.

Migration `0004_car_plate.sql` adds the column and a matching 20-character database constraint. Existing cars receive an empty plate.

## Archiving

Archiving removes a vehicle from active counts and reminder digests while its history, receipts, schedules, and spending remain available. Archiving does not reset schedules, odometers, service history, photo storage, or account notification preferences. Restore resumes calculations from saved dates and odometers, so a restored overdue vehicle returns with its original overdue targets. Cloud archive/restore requires a successful online save; guest changes persist locally.

Apply `supabase/migrations/0011_archive_vehicles.sql` before deploying vehicle archiving, and run `supabase/tests/archive_vehicles.sql` against staging. Then verify archive/restore with a guest garage and a cloud account: archive an overdue vehicle, verify it disappears from active counts and digests while history, receipts, schedules, and spending remain available, and restore it to confirm its original overdue targets return. Check both languages and desktop/mobile controls. Reminder handling of archived vehicles is described in [account reminders](account-reminders.md#scheduling-and-delivery-semantics).

## Make and model suggestions

**Add a car** and **Edit car** offer editable Make and Model suggestions whenever Supabase is configured, including signed-out guests. Prototype mode keeps plain inputs and performs zero catalog requests. Makes load when the modal opens; models load only for the exact make after trimming, collapsing whitespace, and ignoring case. Year does not filter suggestions. Changing make preserves the typed model. Lists are paginated and cached in memory per project and make; typing filters locally. Failed reads offer a retry and never block car entry or saving.

Up to ten suggestions appear, ordered by exact match, prefix, then substring, alphabetically within each group. Use Arrow Up/Down and Enter to choose, Escape to dismiss, or tap/click an option. Tab and blur preserve free text. Suggestions are optional: unknown names and arbitrary make/model pairs are accepted, with the existing required/50-character fields and trim-on-save behavior. There is no VIN lookup or vehicle verification, and cars have no catalog foreign keys.

The catalog's data source, regeneration, and deployment are described in [vehicle catalog](vehicle-catalog.md).
