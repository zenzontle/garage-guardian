# Other costs

**Other costs** (`/costs`, or `/costs?car=[carId]` for one vehicle) records what a car costs beyond service visits and fuel: insurance, registration, inspection or emissions, vehicle tax, loan or lease payments, parking, tolls, washing and detailing, and anything else.

## Fields

| Field         | Notes                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Vehicle, date | The date cannot be in the future. Archived vehicles stay selectable for late receipts.            |
| Category      | One of the fixed categories above. Reports group costs by category.                               |
| Description   | Optional, up to 100 characters, e.g. "6-month policy".                                            |
| Amount        | Integer cents in the receipt currency: USD, MXN, or CAD.                                          |
| Renews on     | Optional. When the cost is due again, such as a policy's end date. Must be after the cost's date. |
| Notes         | Optional, up to 2,000 characters.                                                                 |

Costs have no photos. Costs export to CSV from the page (headers in English, with the same home-currency columns as the service history export), and **Import CSV** adds costs from a file; see [CSV import](csv-import.md).

## Renewals

A cost with a renewal date is a reminder. A recurring cost is a vehicle, category and description (case and spacing are ignored), so two policies on one car, or a membership logged as Other, stay separate from one-off costs. Its most recent payment decides: logging the next one settles the reminder, and its own renewal date, if any, becomes the next one. The renewal is **due** on or after its date and **coming up** within the vehicle's day window (the same one maintenance uses). Due and coming-up renewals appear under **What needs attention** on the dashboard and count toward its Due now and Coming up totals. Their **Log** button opens the next payment with the same vehicle, category, description and currency.

Archived vehicles show no renewals. Renewals are in-app only; the weekly email covers maintenance.

## Currency and reports

Costs convert to the home currency in the background, like fill-ups, using the same ECB rates as service visits (see [multi-currency](multi-currency.md)). Unlike service visits, fill-ups and costs keep only automatic conversions: there is no manual override. Pending conversions are excluded from totals and counted, and edits that change the date, amount, or currency invalidate the saved conversion.

Reports and the dashboard's year-to-date spending include service, fuel, and other costs. Reports add a **By type** breakdown and a **cost per mile** (or kilometer): the spending of each car whose distance is known, over the distance between its lowest and highest dated odometer readings (service visits and fill-ups) in the selected period. Cars with different distance units cannot be combined; choose one car to see its cost per distance.

## Storage and accounts

Guest costs stay in the browser and move to the account on signup, verified like the other records. Account costs are stored in `expenses` with owner-only row security. Deleting a vehicle deletes its costs. Signed-in accounts can read cached costs offline, but saving or deleting one requires a connection; like fill-ups, there is no offline queue.

## Deployment

Apply `supabase/migrations/0015_ownership_costs.sql` **before** deploying the application, then run `supabase/tests/ownership_costs.sql` as an administrator. The migration adds the `expenses` table, a `conversions` column on `fuel_entries`, conversion-preserving update triggers for both, and the `save_fuel_conversion` and `save_expense_conversion` background-save functions.
