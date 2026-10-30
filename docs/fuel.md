# Fuel log

Log each fill-up from **Fuel log**, a vehicle's page, or the dashboard's **Log fuel** button. Fill-ups keep the odometer current for distance reminders and measure fuel economy.

## Fields

| Field                 | Notes                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Vehicle, date         | The date cannot be in the future. Archived vehicles stay selectable for late receipts.                                |
| Odometer              | Required, in the vehicle's distance unit. Prefilled with the latest entered odometer.                                 |
| Volume and unit       | US gallons or liters, chosen per fill-up. Stored as integer thousandths (12.345 gal → `12345`).                       |
| Gas type              | Regular, midgrade, premium, diesel, E85, or other.                                                                    |
| Price per unit, total | Price is stored in thousandths of the currency per unit ($3.459 → `3459`); the total in cents.                        |
| Currency              | USD, MXN, or CAD. Fill-ups are not yet converted to the home currency or included in reports.                         |
| Full tank             | On by default. Economy is measured between full tanks.                                                                |
| Missed previous       | Marks that a fill-up before this one was never logged, so the economy for that stretch is skipped instead of guessed. |
| Station, notes        | Optional. Stations suggest names used before for the same vehicle.                                                    |
| Photos                | Up to 3, prepared and uploaded like service visit photos.                                                             |

Any two of volume, price, and total calculate the third: the two most recently typed amounts win. Typing over a calculated amount keeps the typed value. A new fill-up starts with the volume unit, gas type, currency, and station of the vehicle's last fill-up, otherwise liters for kilometer vehicles, gallons for mile vehicles, regular, and the home currency.

Odometer readings must not go backwards over time: a fill-up cannot be lower than an earlier-dated fill-up or higher than a later-dated one for the same vehicle. Fill-ups on the same day may be in any order.

## Odometer and reminders

The latest entered odometer is the highest of the vehicle's own reading, its service visit readings, and its fill-up readings. Due status, the dashboard, the weekly reminder email, and the first due point of new interval-only tasks all use it. See [maintenance schedules](maintenance-schedules.md).

## Fuel economy

Fill-ups for each vehicle are ordered by odometer, then date. Each full-tank fill-up closes a segment that starts at the previous full-tank fill-up:

- **Distance** is the odometer difference between the two full tanks.
- **Fuel** is everything pumped after the starting full tank through the closing one, including partial fills.
- A segment is skipped when any fill-up in it is marked **missed previous**, or when its distance is zero.

Volumes are converted to liters (1 US gallon = 3.785411784 L). Mile vehicles show miles per US gallon (MPG); kilometer vehicles show liters per 100 km. The vehicle average is total distance over total fuel across its measured segments, not the mean of segment results.

## Storage and accounts

Guest fill-ups and photos stay in the browser and move to the account on signup, verified like visits and their photos. Account fill-ups are stored in `fuel_entries` with owner-only row security; photos use the private visit photo bucket. Deleting a vehicle deletes its fill-ups and their photos.

Signed-in accounts can read cached fill-ups offline, but saving or deleting a fill-up requires a connection; there is no offline queue for fill-ups yet.

## Deployment

Apply `supabase/migrations/0012_fuel_entries.sql` **before** deploying the application, then run `supabase/tests/fuel_entries.sql` as an administrator. The migration adds the `fuel_entries` table and replaces `initialize_schedule_defaults` so cloud first due points also count fill-up readings, matching the browser.
