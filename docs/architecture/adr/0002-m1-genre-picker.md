# ADR 0002 — M1: Genre picker over free-text chat

**Status:** Accepted (supersedes a same-session chat-parser draft, deleted before implementation)
**Date:** 2026-09-03
**Milestone:** M1

## Context

M0 shipped a plain popularity grid on `/`. M1 turns that surface into
something intent-driven. The initial draft of M1 proposed a chat input with a
deterministic keyword/synonym parser that mapped free text to
`DiscoverParams` and posted to a new `/api/chat` route. The product owner
revised the design before implementation started: **no free-text input, no
parser, no LLM** — just one question with clickable options.

This ADR captures the revised design and records why the chat approach was
dropped.

## Decision

### Shape — one page, one question, no new routes

- `/` renders a single question ("What are you in the mood for?") and a row
  of ten whitelisted **genre chips**.
- A chip tap fires one client-side `GET /api/movies/discover?genre=<id>`
  (the M0 route, unchanged).
- The response replaces the results area. Selected chip is marked
  `aria-pressed="true"`.
- There is **no `/api/chat`**, no `parseIntent`, no `src/lib/intent.ts`.
- `src/app/api/movies/discover/route.ts` stays — it is now on the primary
  path, not a debug surface.

### Data flow

```
client picker page
      │  GET /api/movies/discover?genre=<id>&sort_by=popularity.desc
      ▼
/api/movies/discover route (server, unchanged from M0)
      ├── Zod-validate query params (genre whitelisted to TMDB_GENRE_IDS)
      ├── discoverMovies(params)         // server-only fetch
      └── respond DiscoverResponse
```

One round trip per tap. TMDB is never called from the browser.

### Chip vocabulary (v1)

Ten TMDB genres, alphabetical:

| Chip | TMDB ID |
|---|---|
| Action | 28 |
| Animation | 16 |
| Comedy | 35 |
| Documentary | 99 |
| Drama | 18 |
| Family | 10751 |
| Horror | 27 |
| Romance | 10749 |
| Science Fiction | 878 |
| Thriller | 53 |

The nine omitted TMDB genres (Adventure, Crime, Fantasy, History, Music,
Mystery, TV Movie, War, Western) are out of scope for M1 chip real estate.
IDs stay whitelisted in `TMDB_GENRE_IDS` so the API accepts them via curl,
they simply aren't offered in the UI.

### File layout

| Path | Change vs M0 | Purpose |
|---|---|---|
| `src/app/page.tsx` | Rewritten (client component) | Genre picker + results grid. |
| `src/app/api/movies/discover/route.ts` | Unchanged | Still the only movie route. |
| `src/lib/tmdb.ts` | Unchanged from M0 | `DiscoverParamsSchema` reverted to `{genre, sort_by, page}`; the era / vote_count extensions are M2 material. |
| `src/lib/env.ts` | Unchanged | — |

No new server-side code. M1 is purely a frontend milestone on top of the M0
route.

### Rate limiting, logging, errors

- **Rate limit** — deferred. `/api/movies/discover` already validates every
  query param and rejects unknown genre IDs with 400. With only 10 chip
  values as the client-side attack surface and no free-text field, the
  incremental risk of skipping a limiter in M1 is small. Add one in M4 when
  Redis lands (tracked in `docs/architecture/tech-debt.md`).
- **Logging** — the existing route already logs `TmdbError`s with class +
  upstream status only (never the URL, which carries the API key). No new
  log lines needed for M1.
- **Errors** — the client renders 4xx/5xx and network failures as the same
  "temporarily unavailable" message. Raw response bodies are never
  surfaced.

## Alternatives considered

- **Chat surface + deterministic parser** (`/api/chat` + `src/lib/intent.ts`,
  6 mood buckets + 19 genres + 5 eras). **Rejected by product** in favor of
  a picker. Rationale: parser misses are a real UX problem, and the whole
  parser exists to guess at English. A tap on "Horror" is unambiguous and
  requires no vocabulary to learn.
- **Chat surface with an LLM parser.** Rejected: paid dependency, latency,
  and a second failure mode before we have evidence the deterministic map
  is insufficient. Also, this whole class of approach is superseded by the
  picker.
- **Auto-load Popular on first visit.** Rejected: the "one question" design
  breaks if the page pre-answers itself. Empty results area with a prompt.
- **Multi-select chips (Horror + Comedy → `with_genres=27,35`).** Rejected
  for M1: adds a "combine or replace?" UX decision and TMDB's AND/OR
  behavior isn't the same for both. Revisit post-M2.

## Consequences

**Locks in**
- `/` is the picker. There is no chat surface in this repo.
- `/api/movies/discover` is on the primary user path — any change to its
  shape ships with the UI change that consumes it.
- Genre-only for M1 means the era / vote-count schema extensions from an
  in-flight branch were reverted; they come back in M2 with the hidden-gem
  toggle.

**Defers**
- Rate limiting → M4 (Redis).
- Secondary filters (era, mood, vibe) → post-M1.
- Multi-select genres → post-M2.
- Hidden-gem scoring → M2.

**Testing gate**
- No parser to unit-test. Manual QA covers the 5 acceptance criteria in
  `docs/product/features/m1-genre-picker.md`. E2E tests are not introduced
  yet — that call belongs to the QA agent on a later milestone that
  actually justifies a Playwright setup.
