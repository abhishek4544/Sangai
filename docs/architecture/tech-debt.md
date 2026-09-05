# Tech debt

Living list. Each item names the trigger (when it must be paid down), not just the item itself.

## Open

### Rate limiting on `/api/movies/discover`
- **Trigger:** before public launch, or M4 (Redis lands) — whichever is first.
- **Why deferred:** M1 surface is 10 whitelisted genre IDs + 8 sort values + page ≤500, no auth, no free text. A scripted client could still burn TMDB quota. Not a code-execution or data-exposure risk.
- **Shape:** IP-keyed bucket. In-memory acceptable for the single-region single-instance stage; move to Redis when M4 introduces it for room state.

### M2 in-memory gems cache → Redis
- **Trigger:** M4.

### Structured logging + error tracker (Sentry)
- **Trigger:** before M4, when we start writing to Postgres and losing a failure becomes user-visible data loss instead of a missed poster fetch.
- **Why deferred:** M1 has two bare `console.error` calls in `src/app/api/movies/discover/route.ts`. `CLAUDE.md` calls for Sentry "from the first milestone" — this is an acknowledged gap.
- **Shape:** Sentry SDK on server routes, JSON log lines that include `route`, `duration_ms`, and an error class name — never a request URL (TMDB URL carries `api_key=…`) and never a raw upstream body.
