# Maintenance schedules

The schedule is owner-entered. Starter tasks are names only; no interval is presented as an OEM recommendation. VIN lookup and automatic manufacturer schedules are not supported.

## Repeat intervals and first due points

Repeat intervals alone are enough. With no first due point, a distance interval uses the next multiple of that interval at or above the latest recorded odometer, including service visit and [fill-up](fuel.md) readings (for example, 69,000 miles with a 5,000-mile interval is first due at 70,000 miles; a zero odometer starts at 5,000). A time interval starts when the task is saved. These automatic first due points are persisted, so reloads, edits to the car's odometer, and the passage of time cannot push them forward. Existing active interval-only tasks are initialized once when loaded by the app or email reminder worker.

An explicit first due point is preserved, and linked service visits advance repeats from their recorded date/odometer. Tasks with neither intervals nor a due point still appear in dashboard setup guidance, with links to their vehicle schedules.

## Approximate due dates

Distance targets also show an approximate date, such as "at 70,000 mi, around Mar 12, 2027", on the dashboard, the vehicle page, and in the [weekly reminder email](account-reminders.md). The date comes from how far the vehicle has been driven recently, in its own distance unit, using the dated odometer readings of service visits and [fill-ups](fuel.md). The vehicle's own odometer has no date, so it does not feed the driving rate.

The logic is in `src/lib/maintenance/forecast.ts`. Only readings from the last 12 months count, and readings dated after today are ignored. Several readings on one day count once, using the highest. Consecutive readings that go backward or stand still (a replaced odometer or a typo) are skipped, as are jumps faster than 1,000 miles or 1,600 kilometers a day. The usable pairs must cover at least three reading days and 30 days in total; otherwise there is no estimate, rather than a guess built on one or two readings.

The estimate starts from the highest dated reading, at the average daily distance, and is never before today. If the vehicle's own odometer is higher than every dated reading, the estimate starts from it today instead. Tasks that are already due, completed, or time-only have no approximate date, and estimates more than three years out are not shown. When a task also has a due date, it is due at whichever comes first: if the due date comes first, only that exact date is shown. Approximate dates never change a task's status or when reminders are sent.

## Logging a task from the dashboard

Due and coming-up tasks under **What needs attention** have a **Log** button. It opens a new service visit for that vehicle with the task already chosen as its completed item, so saving it advances the schedule like any linked visit.

## Visit odometer readings

A service visit's odometer is optional; unknown readings are stored as null rather than zero (`0006_optional_visit_odometer.sql`). A service visit without an odometer does not advance a distance target.

## Deployment

Apply migrations `0008_schedule_defaults.sql` and `0009_atomic_schedule_saves.sql` before deploying schedule defaults: cloud initialization and interval-only saves lock the car and visit readings in the same transaction as the write. Initialization returns the current schedule if another tab edits or deletes it. Run `supabase/tests/schedule_defaults.sql` and `supabase/tests/atomic_schedule_saves.sql` after migrating.
