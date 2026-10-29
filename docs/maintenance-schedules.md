# Maintenance schedules

The schedule is owner-entered. Starter tasks are names only; no interval is presented as an OEM recommendation. VIN lookup and automatic manufacturer schedules are not supported.

## Repeat intervals and first due points

Repeat intervals alone are enough. With no first due point, a distance interval uses the next multiple of that interval at or above the latest recorded odometer (for example, 69,000 miles with a 5,000-mile interval is first due at 70,000 miles; a zero odometer starts at 5,000). A time interval starts when the task is saved. These automatic first due points are persisted, so reloads, edits to the car's odometer, and the passage of time cannot push them forward. Existing active interval-only tasks are initialized once when loaded by the app or email reminder worker.

An explicit first due point is preserved, and linked service visits advance repeats from their recorded date/odometer. Tasks with neither intervals nor a due point still appear in dashboard setup guidance, with links to their vehicle schedules.

## Visit odometer readings

A service visit's odometer is optional; unknown readings are stored as null rather than zero (`0006_optional_visit_odometer.sql`). A service visit without an odometer does not advance a distance target.

## Deployment

Apply migrations `0008_schedule_defaults.sql` and `0009_atomic_schedule_saves.sql` before deploying schedule defaults: cloud initialization and interval-only saves lock the car and visit readings in the same transaction as the write. Initialization returns the current schedule if another tab edits or deletes it. Run `supabase/tests/schedule_defaults.sql` and `supabase/tests/atomic_schedule_saves.sql` after migrating.
