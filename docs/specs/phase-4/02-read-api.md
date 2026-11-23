# Phase 4 — Task 2: Read API

Part of [Phase 4](README.md). Two read-only routes behind the [Access check](01-access-check.md): one to search logs, one to list apps for the viewer's dropdown.

Contract: [Phase 1 — API endpoints, "Reading logs"](../phase-1/02-api-endpoints.md#reading-logs-admin-only-behind-cloudflare-access) (updated for Phase 4).

## `GET /v1/admin/logs`

Filters, all optional and combined with AND:

| Filter | Example | Matches |
|---|---|---|
| `app` | `?app=maslary` | one app |
| `level` | `?level=error&level=fatal` | any of the listed levels |
| `event` | `?event=api_failed` | exact event name |
| `session` | `?session=b3f1c2e0-…` | **new:** one session, to see everything that happened in it |
| `from` / `to` | `?from=2026-11-20T00:00:00Z` | server receive time, `from` inclusive, `to` exclusive |
| `limit` | `?limit=200` | page size, default 100, max 500 |
| `cursor` | `?cursor=…` | next page, from the previous response |

- Newest first.
- Each page returns `nextCursor`; pass it back as `cursor` to get older logs. `null` means no more.
- The cursor is the id of the last log on the page ("give me logs older than this one"). It's stable even while new logs arrive.
- Times come back as ISO strings; `params` and `context` come back as JSON objects.
- Bad filters (unknown level, `to` before `from`, a made-up cursor…) → `400 invalid_query` with a message saying what's wrong.

No new database migration: the existing indexes (`app + id`, `app + level + id`, `received_at`) already cover these searches at this scale.

## `GET /v1/admin/apps`

Returns all apps (id, display name, whether it's disabled), sorted by id. Disabled apps are included because their old logs can still be searched.

## Shared package changes

- `session` added to the query schema (1–64 characters, same limit as `sessionId` in the envelope).
- New types `AppSummary` and `AppsResponse`.
- Code comments that still say `GET /v1/logs` are updated.

## Responses are never cached

Both routes send `Cache-Control: no-store`, so log data isn't kept in browser or proxy caches.

## Tasks

- [ ] Review the design above.
- [ ] Agent implements [02-read-api.tech.md](02-read-api.tech.md) (local only).
- [ ] Commit: "Phase 4: read API".

## Done when

- The verification in the tech spec passes locally, including paging through more than one page and every filter.
- Without the Access check passing, both routes return `401`.
