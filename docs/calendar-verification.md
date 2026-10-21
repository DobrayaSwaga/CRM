# Calendar sprint verification

## Reproducible checks

```sh
npm run setup
npm run build
npm --prefix server test
git diff --check
```

The API suite uses a temporary SQLite database, migrates a legacy `tasks` table,
and deletes its database on completion. No production data or sessions are used.
It covers authentication, personal/shared visibility, author/assignee/admin
permissions, editing/deleting, validation, exclusive range ends, overnight and
all-day events, and private-task filtering in contact cards, notifications,
analytics and XLSX exports. All 14 tests passed on Node 22.22.3.

## Browser smoke test

A separate Chromium/Playwright session against the production build and a
throwaway database verified:

- create, open and edit calendar events; typing does not remount/reset the form;
- day/week/month switching, 42-cell month grid and layer toggles;
- creation of a shared task, completion and showing completed tasks;
- 21:00 slot creates a 21:00–22:00 event;
- plan entries open read-only details instead of crashing or switching pages;
- simulated calendar API failure shows an error and a working retry;
- Escape closes the editor;
- 390px mobile viewport has no page-width overflow; navigation opens/closes;
- light and dark rendering; no uncaught browser page errors.

## Behavior / limitations

- This is a calendar-oriented UI inspired by the requested layout, not a
  pixel-for-pixel copy: the screenshot from the earlier session was unavailable.
- Times are local wall-clock values, not timezone-converted appointments.
- All-day event end dates are exclusive. Multi-day events and entries outside
  07:00–22:00 remain visible in the upper band. Tasks are deadlines shown as
  30-minute blocks, not duration-based appointments. Overlaps use columns.
- Shared does not mean editable by everyone. Event authors/admins can edit;
  task creators/assignees/admins can edit. Legacy tasks remain shared.
- Existing role checks remain on contact-enriched task lists and bulk operations;
  every signed-in user can use the calendar and create individual events/tasks.
- Current license is attribution-based and not MIT; earlier MIT grants are not
  revoked. Legal review is recommended before relying on the revised terms.

## Existing dependency audit warnings

`npm audit` reports high-severity advisories in `xlsx` (prototype pollution / ReDoS,
no npm fix available) and client build tooling `vite` / `source-map-js`.
This sprint does not replace the spreadsheet import/export stack or update the
build toolchain. Untrusted spreadsheets should not be imported until the existing
SheetJS issue is addressed. Production preview used the static build, not Vite.
