# Phase 4 — Task 3: Viewer Page

Part of [Phase 4](README.md). A single page at `/admin/` to search your logs. Plain HTML, CSS and JavaScript served by the Worker as static files: no framework, no build step. The admin UI stack is decided later, in Phase 7.

## Layout

```
┌───────────────────────────────────────────────────────────────────────────┐
│ pixie-logger                                                              │
├───────────────────────────────────────────────────────────────────────────┤
│ App [All apps ▾]  Level ☐debug ☐info ☐warn ☑error ☑fatal                  │
│ Event [________]  Session [______________]                                │
│ Received from [date-time]  to [date-time]   Per page [100 ▾]              │
│ [Search]  [Reset]                                                         │
├───────────────────────────────────────────────────────────────────────────┤
│ Received          App         Level  Event        Message          Platform│
│ 23 Nov 16:02:11   taqa-local  ERROR  api_failed   Timeout loadi…   web     │
│ ▼ details: message, route, params, context (formatted JSON),              │
│   session id [Show this session], app version, client time, server time, id│
│ 23 Nov 16:01:58   taqa-local  INFO   page_view    —                web     │
│ …                                                                         │
│                              [Load more]                                  │
└───────────────────────────────────────────────────────────────────────────┘
```

## Behaviour

- **App dropdown** is filled from `GET /v1/admin/apps`; disabled apps show "(disabled)".
- **Filters** match the API: app, levels (none ticked = all), event, session, received from/to, page size (50/100/200/500, default 100). Dates are entered in your local time and sent to the API in UTC.
- **Search** runs the query; **Reset** clears all filters and searches again. The page also searches once on load.
- **Filters are kept in the address bar** (e.g. `/admin/?app=taqa-local&level=error`), so a reload keeps them and you can bookmark a search.
- **Click a row** to open its details: full message, route, `params` and `context` as formatted JSON, app version, platform, session id, client time and server receive time, log id.
- **Show this session** (in the details) sets the session filter to that row's session and clears the other filters, to see everything that happened in it.
- **Load more** appears while there are older logs; it adds the next page below.
- **States:** "Loading…", "No logs match these filters", and errors showing the API's message. If your Access sign-in has expired, the page says so and asks you to reload (Access will ask you to sign in again).
- Levels are colour-coded (error/fatal stand out). Times are shown in your local time zone with seconds.
- Works on a laptop screen; on a phone the table scrolls sideways.

## Safety

Log messages, event names and JSON values come from your apps, and a bug or a leaked app key could put HTML or script-like text in them. The page:

- shows every value as **plain text** (never inserted as HTML),
- loads nothing from other sites, and
- is served with a strict Content-Security-Policy, so even a mistake can't run injected code.

## Clean-up in this task

- The hello-world `public/index.html` and the `GET /message` route are removed. `/` now returns `404`.

## Out of scope

- Live tail / auto-refresh, charts, counts, export, dark mode toggle (it follows the system setting at most).
- Anything that changes data (Phase 7).

## Tasks

- [ ] Review the layout and behaviour above.
- [ ] Agent implements [03-viewer.tech.md](03-viewer.tech.md) (local only).
- [ ] You try it locally (see "Manual checks" in the tech spec).
- [ ] Commit: "Phase 4: viewer page".

## Done when

- The viewer works locally against seeded test logs, including every filter, paging and "Show this session".
- A log message containing HTML is shown as text, not rendered.
