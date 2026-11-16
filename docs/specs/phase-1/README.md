# Phase 1: Logging Contract

Define the single contract every part of pixie-logger depends on. Phase 1 is split into three tasks:

| # | File | What it covers |
|---|------|----------------|
| 1 | [01-event-contract.md](01-event-contract.md) | Log levels, event shape, batch envelope, app identification |
| 2 | [02-api-endpoints.md](02-api-endpoints.md) | `POST /v1/logs` and `GET /v1/logs`: requests, validation flow, responses |
| 3 | [03-shared-package.md](03-shared-package.md) | `@pixie-logger/shared`: zod schemas, types, constants, tests |

Tasks 1 and 2 are design (they define *what*); task 3 is the implementation (it turns them into code).

## Technical specs (for implementation by an agent)

Each task has a `.tech.md` file with exact files, code requirements, tests and verification steps.

**Implement in this order:** 03 → 01 → 02 (the package must exist before code goes into it).

| Order | File | What the agent builds |
|---|---|---|
| 1st | [03-shared-package.tech.md](03-shared-package.tech.md) | Package scaffold, tooling, wiring into `apps/api`, `/v1/health` route |
| 2nd | [01-event-contract.tech.md](01-event-contract.tech.md) | Constants, event + envelope schemas, `levelAtLeast`, `utf8ByteLength`, `formatZodIssues` |
| 3rd | [02-api-endpoints.tech.md](02-api-endpoints.tech.md) | Error codes, `validateEvents`, read-query schema, response types |

To hand one to an agent: *"Implement `docs/specs/phase-1/<file>.tech.md` exactly as written. Follow its 'Rules for the agent' section."*

## Goals

- One source of truth for the event and batch shapes.
- Strict limits so a leaked write key can't flood the database.
- One bad event must not cause the rest of a batch to be lost.
- Versioned API (`/v1`) so the contract can change later without breaking older app releases.

## Out of scope (later phases)

- Implementing the endpoints and database tables (Phase 2).
- The client logger package (Phase 3).
- The viewer page and Cloudflare Access (Phase 4).
- Rate limiting, CORS and retention cleanup (Phase 5).

## Phase 1 is done when

All three task files are marked done. Any later change to the contract updates these files in the same commit.
