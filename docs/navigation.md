# Navigation

## Routes

Dashboard lives at `/`, Vehicles at `/cars`, individual vehicles at `/cars/[carId]`, Service history at `/history`, the Fuel log at `/fuel` (`/fuel?car=[carId]` filters to one vehicle), and Reports at `/reports`. Vehicles opens the first car and replaces `/cars` with its detail URL, or shows the empty garage when no cars exist. Reloads, bookmarks, browser Back/Forward, and opening navigation links in a new tab work across these screens. Vehicle IDs remain stable when names change.

Sign-in and create-account use `/signin` and `/signup`. Their validated `returnTo` parameter returns to the originating workspace screen; direct visits default to Dashboard. Account settings live at `/settings/account`, `/settings/security`, and `/settings/notifications`.

A missing vehicle keeps its URL and displays an unavailable message. Guest/prototype bookmarks depend on data stored in that browser and origin; cloud bookmarks require access to the vehicle in the current account. Dialogs and history/report filters remain local UI state and are not restored from URLs.

## Keyboard and mobile navigation

Vehicle links support Left/Right (with wrapping) and Home/End to move focus; Enter opens the focused vehicle. Every link also remains reachable with Tab. On phones, opening the navigation drawer focuses the current page link; Escape closes it and returns focus to the menu button. The drawer also closes when focus leaves or the viewport becomes desktop.

## Responsive layout

Service history uses stacked visit cards at widths of 720px and below and a table above that breakpoint. Both views share filters, sorting, CSV export, and expanded visit details. Shared styles use larger text and a minimum 44px target for actions.

Unsaved-change prompts, dialog focus, and save/delete confirmations are described in [interaction states](interaction-states.md).
