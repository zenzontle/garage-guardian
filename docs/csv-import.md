# CSV import

**Import CSV** on **Service history**, **Fuel log**, and **Other costs** adds records from a spreadsheet or another tracker. It also reads the CSV those pages export, so records can be moved to another garage or restored. Nothing is saved until the owner confirms the preview. The import needs at least one vehicle, and works the same for guests and accounts.

## File

- The first row names the columns. Commas, semicolons, or tabs separate fields; the separator is taken from the header row. Quoted fields may hold separators, quotes (`""`), and line breaks. A byte order mark and blank lines are ignored.
- Files up to 2 MB, and the first 2,000 data rows. Rows past that are counted as skipped and not read.
- The export's spreadsheet formula guard (an apostrophe before text starting with `=`, `+`, `-`, `@`, tab, or carriage return) is removed, so exported text imports unchanged. The one exception is a service name containing `;` or `|`, which the export cannot tell apart from two services.

## Columns

Columns are matched to fields by name, ignoring case, accents, punctuation, and a unit or currency in parentheses, in English and Spanish (for example `Odometer`, `Odómetro (km)`, `Mileage`, `Kilometraje`). Each column feeds at most one field. The export's own headers always match. The owner can change any match under **Columns**; choosing a column for one field takes it from another.

| Kind           | Required                                                | Optional                                                                                                    |
| -------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Service visits | Date, services                                          | Vehicle, odometer, distance unit, item costs, total, currency, provider, notes                              |
| Fill-ups       | Date, odometer, volume, and a price per unit or a total | Vehicle, distance unit, volume unit, currency, gas type, full tank, missed previous fill-up, station, notes |
| Other costs    | Date, category, total                                   | Vehicle, description, currency, renews on, notes                                                            |

**Vehicle for these records** chooses where rows go: the file's vehicle column, or one vehicle for every row (preselected when the file has no vehicle column, from the page's vehicle filter or the first active vehicle). Vehicle names match the garage's names ignoring case and spacing; an active vehicle wins over an archived one with the same name. A row's currency is its currency column, else a currency its amounts name (`MX$250`, `500 MXN`, or a header like `Total (MXN)`), else **Currency when a row has none**, which defaults to the home currency.

## Values

| Field                | Accepted                                                                                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dates                | `YYYY-MM-DD` (a time after it is ignored) or `YYYY/MM/DD`, and day/month/year with a four-digit year in the order chosen under **Dates written like 3/4/2026**. Not in the future.                                                                                                          |
| Order of day/month   | Detected for each file from a date whose first or second number is above 12; otherwise month first in English and day first in Spanish.                                                                                                                                                     |
| Money                | A decimal point and up to two decimals; `$`, `US$`, `MX$`, `CA$`, a trailing currency code, and thousands commas (`1,234.50`) are allowed. An amount naming another currency than its row's is an error. A decimal comma is rejected rather than guessed.                                   |
| Odometer             | A whole number in the vehicle's unit. A distance unit column (`mi`, `km`) or a unit in the odometer header (`Odometer (km)`, `Miles`) must match the vehicle; readings are never converted.                                                                                                 |
| Volume, unit price   | Up to three decimals, like the fill-up form. Volume units are gallons or liters (`gal`, `L`, `litros`), from a volume unit column, else the volume header (`Liters`), else the vehicle's default (liters for kilometer vehicles). A unit column that disagrees with the header is an error. |
| Services, item costs | Services are separated by `;`, `\|`, or line breaks, each up to 80 characters. Item costs use the export's `Name: 12.50; Other: 3.00` and must name listed services. Item costs cannot exceed the total.                                                                                    |
| Gas type             | The fill-up types and common names (`unleaded`, `magna`, `super`, `diésel`). Unknown names import as **Other** with a warning.                                                                                                                                                              |
| Category             | The cost categories, their English and Spanish labels, and common names (`tenencia`, `casetas`). Unknown names import as **Other**, with the file's category as the description if it had none.                                                                                             |
| Yes/no               | `yes`, `no`, `sí`, `true`, `false`, `1`, `0`, `x`. Full tank defaults to yes and missed previous to no.                                                                                                                                                                                     |

Text longer than the form allows (100 characters for providers, stations, and descriptions, including an unknown category kept as the description; 2,000 for notes) is an error rather than cut.

Fill-up odometers must stay in order with the vehicle's saved fill-ups and the file's other fill-ups, as in the [fuel log](fuel.md#fields). When two imported fill-ups conflict, both are errors. A service item named like one of the vehicle's active maintenance tasks (ignoring case) completes that task, as choosing it in the visit form would.

## Preview and duplicates

The preview counts rows **ready to import**, **already saved**, and **can't import**, and lists up to 50 rows to review with every problem found in each, including warnings on rows that will import. Rows are numbered as in a spreadsheet, with the header as row 1.

A row is **already saved** when it matches a saved record or an earlier row in the file:

| Kind           | Same                                     |
| -------------- | ---------------------------------------- |
| Service visits | Vehicle, date, odometer, total, currency |
| Fill-ups       | Vehicle, date, odometer, volume, total   |
| Other costs    | Vehicle, date, category, total, currency |

They are skipped unless **Also import rows that look already saved** is checked.

## Saving

Records are saved one at a time, in file order, through the same paths as the forms, so guest records stay in the browser and account records go to the cloud. Imported records have no photos or conversions; receipts in another currency convert to the home currency in the background like any new receipt. Each record's creation time keeps the file's order for same-day records.

Fill-ups and other costs need a connection for accounts; service visits use the [offline receipt queue](multi-currency.md). If a save fails, the records saved before it stay saved, the garage refreshes, and the dialog says how many were saved. Importing the file again adds the rest, since saved rows then show as already saved. The dialog protects a chosen file like an unsaved form, and cannot be closed while saving.
