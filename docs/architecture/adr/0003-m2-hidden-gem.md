# ADR 0003 — M2: Hidden-gem toggle

**Status:** Accepted
**Date:** 2026-09-03
**Milestone:** M2

## Context

M2 puts the hidden-gem scoring named in `CLAUDE.md` behind a picker toggle:
one tap flips the M1 shortlist from "popular in this genre" to "well-rated
but under-seen in this genre", with a 4-stop obscurity control for how deep
the user wants to go. This is the product's stated moat — no competing "what
should we watch" surface (TwoSeven, SyncUp, Parsec, the streamer home
screens) scores for good-but-under-seen; they all collapse to the same
trending list. Shipping M2 as a first-class toggle on the picker is the
milestone that makes that moat visible in the product.

The scoring runs **server-side**, not in the browser. Three reasons:
1. **Payload.** The client only needs the filtered ≤20-poster list, not the
   ~60-movie sample plus `vote_count`, `WR`, and the genre-median stat used
   to derive it.
2. **Iteration.** The `WR >= 7.2` threshold, the vote-count bands, and the
   sampling window are all going to move as we look at real usage. Moving a
   server constant is a deploy; moving a client constant is a deploy plus a
   cache-bust plus a stale-tab window.
3. **Key hygiene.** The TMDB API key stays entirely server-side, same as
   M0/M1. The client never learns it exists.

## Decision

### Route — new endpoint, do not overload `/discover`

`GET /api/movies/gems?genre=<id>&obscurity=<0|1|2|3>`

- New route file: `src/app/api/movies/gems/route.ts`.
- Reuses the M1 error-mapping shape (Zod fail → 400, `TmdbError` → 503,
  other → 500 with narrowed `console.error` — never stringify the URL, it
  carries `api_key=…`).
- `/api/movies/discover` is **unchanged**. Toggle OFF on the picker keeps
  hitting `/discover` exactly as M1 does today.

Why a new route rather than `/discover?mode=gems`: `/discover` is a raw
proxy — its response shape is TMDB's `DiscoverResponse` (`page`,
`total_pages`, `total_results`, `results`). The gems endpoint returns a
different shape (`results`, `stats`, `obscurity`) with derived server-side
stats. Overloading one route with two response contracts is worse than
having two routes with one contract each.

### Formula module — `src/lib/hidden-gem.ts`

Pure functions. **No I/O, no `server-only` import** so the module is safe to
import from Vitest without a Node/Next server context. Named exports:

```ts
export const GEM_THRESHOLD = 7.2;  // WR floor from CLAUDE.md
export const M_VOTE_FLOOR  = 300;  // `m` in the WR formula; CLAUDE.md
                                   // says "tune this" — 300 is the M2 seed
// Obscurity vote_count band is NOT a constant here; the caller passes it
// in via `opts`, because the slider controls it.

export function weightedRating(
  input: { R: number; v: number; m: number; C: number },
): number;

export function computeStats(
  movies: ReadonlyArray<Movie>,
): { C: number; genreMedianPopularity: number; sampleSize: number };

export function isHiddenGem(
  movie: Movie,
  stats: { C: number; genreMedianPopularity: number },
  opts: { voteCountMin: number; voteCountMax: number;
          gemThreshold?: number; m?: number },
): boolean;
```

`isHiddenGem` applies the full CLAUDE.md gate:
`WR >= (opts.gemThreshold ?? GEM_THRESHOLD)`
AND `vote_count` in `[voteCountMin, voteCountMax]`
AND `popularity < stats.genreMedianPopularity`.

`computeStats` defines `C` as the mean of `vote_average` across the passed
sample and `genreMedianPopularity` as the median of the `popularity` field.
`sampleSize` is `movies.length`, exposed so the response can carry it for
observability without leaking the raw sample.

The `Movie` type imported by these signatures is the one already exported
from `src/lib/tmdb.ts` — but note TMDB's `Movie` schema does not currently
include `popularity`. Adding `popularity: z.number()` to `MovieSchema` in
`tmdb.ts` is part of the M2 implementation slice and is called out here so
it doesn't get missed.

### Slider mapping — 4 discrete stops

The obscurity slider is an integer `0..3`. The route maps it to a
`{voteCountMin, voteCountMax}` band before calling `isHiddenGem`. These are
server constants; the client never sees them.

| `obscurity` | Label       | `voteCountMin` | `voteCountMax` |
|-------------|-------------|----------------|----------------|
| 0           | Mainstream  | 1000           | 10000          |
| 1           | Mixed       | 500            | 5000           |
| 2           | Underground | 200            | 2000           |
| 3           | Deep cut    | 50             | 500            |

Note the CLAUDE.md canonical envelope is `50..2000` — that spans roughly
stops 2–3 in this table. Stops 0–1 relax the ceiling above 2000 so
"Mainstream" and "Mixed" have anywhere to draw from at all; the popularity
gate (`popularity < genreMedianPopularity`) is what keeps those two stops
from collapsing back into the M1 trending list.

### Sampling strategy

Fetch TMDB `/discover` pages 1, 2, 3 in parallel via `Promise.all`
(≈60 movies) sorted by `popularity.desc` filtered to the requested genre.
Concatenate `results`, run `computeStats` on the concatenated array, then
filter with `isHiddenGem` and cap at 20 posters in the response.

If any of the three page fetches rejects, the whole request fails with the
standard `TmdbError` → 503 mapping. We do **not** return a half-sample —
`C` and the genre median would be biased by whichever pages happened to
succeed, which is worse than a clean failure the client can retry.

### Cache — in-memory, per-instance, capped

A module-level `Map<string, { data: GemsResponse; expiresAt: number }>` in
`src/app/api/movies/gems/route.ts`.

- **Key:** `${genre}:${obscurity}`.
- **TTL:** 5 minutes.
- **Max size:** 128 entries. On insert past the cap, evict the oldest entry
  (FIFO). The cap is a hard requirement, not a nice-to-have — an unbounded
  `Map` keyed by client-controlled params is a memory-DoS surface.
- **Scope:** per Node process. Two Vercel instances will diverge; for M2
  that is fine (the sample is stable over minutes, the divergence is
  invisible to a user on one session).

Redis is the correct long-term home for this cache, but Redis lands in M4.
Adding it in M2 pulls M4 infra into an otherwise-serverless milestone. The
in-memory cache is tracked as debt in `docs/architecture/tech-debt.md` with
M4 as the trigger.

### Request / response contract

Request: `GET /api/movies/gems?genre=<TMDB_GENRE_ID>&obscurity=<0|1|2|3>`.
`genre` is required and validated against `TMDB_GENRE_IDS`.
`obscurity` is required and validated as an integer in `[0, 3]`.

Response (200):
```json
{
  "results": [ /* filtered gem Movie objects, max 20 */ ],
  "stats": { "C": 6.8, "genreMedianPopularity": 42.3, "sampleSize": 60 },
  "obscurity": 2
}
```
`stats` is included primarily for observability (the M2 success metrics
compare `sampleSize` and the resulting median `vote_count` against the
unfiltered discover baseline). The client does not render it, per the PM
spec — the toggle stays opaque to the user.

### Error mapping

Same shape as `/api/movies/discover`:

| Failure                                    | HTTP | Body                                    |
|--------------------------------------------|------|-----------------------------------------|
| Zod rejects `genre` or `obscurity`         | 400  | `{ error: "invalid_params", issues }`   |
| `TmdbError` from any of the 3 page fetches | 503  | `{ error: "movie_service_unavailable" }`|
| Anything else                              | 500  | `{ error: "internal_error" }`           |

`console.error` lines never include the request URL (carries the API key)
and never include the raw upstream body. Log the error class + upstream
status only, same as `discover`.

### Client fetch shape

The picker page (`src/app/page.tsx`) inspects the toggle:
- Toggle OFF → existing M1 `GET /api/movies/discover?genre=<id>` path,
  unchanged.
- Toggle ON  → `GET /api/movies/gems?genre=<id>&obscurity=<0..3>`.

Exactly one request per user action (toggle flip, obscurity stop change,
genre chip change) per the PM ACs. The client reads `response.results`
into the existing results grid — the grid renderer doesn't need to know
which endpoint served it.

### File layout

| Path                                    | Change    | Purpose                                             |
|-----------------------------------------|-----------|-----------------------------------------------------|
| `src/lib/hidden-gem.ts`                 | **New**   | Pure formula module. `weightedRating`, `computeStats`, `isHiddenGem`, `GEM_THRESHOLD`, `M_VOTE_FLOOR`. No I/O, no `server-only`. |
| `src/app/api/movies/gems/route.ts`      | **New**   | GET handler, Zod validation, parallel 3-page sample, formula call, in-memory cache with FIFO cap, error mapping. |
| `src/lib/tmdb.ts`                       | Extend    | Add `popularity: z.number()` to `MovieSchema` (needed by `computeStats`). No other changes. |
| `src/app/page.tsx`                      | Extend    | Add hidden-gems switch + 4-stop segmented control per the PM ACs; route selection based on toggle state. |
| `src/app/api/movies/discover/route.ts`  | Unchanged | Toggle-OFF path stays exactly as M1. |
| `tests/lib/hidden-gem.test.ts`          | **New**   | Unit tests for the formula module — see Consequences. |

## Alternatives considered

- **Overload `/api/movies/discover?mode=gems`.** Rejected: the gems response
  needs `stats` and `obscurity` fields that don't fit the raw TMDB proxy
  contract; conditional response shapes on one route is worse than two
  routes with clean shapes.
- **Compute the formula client-side.** Rejected: ships the ~60-movie sample
  plus `vote_count`/`popularity` to the browser, forces client-side
  revalidation of the schema, makes memoization per-tab instead of
  per-instance, and puts a formula that will be tuned into a client-cached
  bundle.
- **Two endpoints — `GET /stats/:genre` + `/discover`, filter client-side.**
  Rejected: two round trips per toggle action, and a race where the client
  filters a fresh `/discover` page against a stale `stats` payload.
- **Continuous obscurity slider.** Rejected by PM: 4 discrete stops are
  easier to tune server-side (a fixed set of `(genre, stop)` cache keys)
  and easier UX (Mainstream/Mixed/Underground/Deep cut labels beat a
  numeric slider with no reference points). Revisit if the discrete stops
  prove too coarse in real usage.
- **Persistent (Redis) cache in M2.** Deferred: Redis lands in M4 for room
  state anyway; pulling it forward into M2 adds infra to a milestone whose
  scope is otherwise a route + a formula + a switch.

## Consequences

**Locks in**
- The gems path is a distinct route with its own response shape.
  `/api/movies/discover` remains a raw TMDB proxy.
- The hidden-gem formula lives in **one** module (`src/lib/hidden-gem.ts`).
  Any change to `GEM_THRESHOLD`, `M_VOTE_FLOOR`, the vote-count bands, or
  the sample size is a single-file change plus a test update.
- `MovieSchema` in `tmdb.ts` gains `popularity` — any consumer that
  destructures `Movie` is unaffected (additive field).

**Defers**
- Persistent cache for the gems sample → M4 (Redis).
- Rate limiting on `/api/movies/gems` → M4 alongside `/discover`
  (same trigger, same shape — IP-keyed bucket in Redis).
- "Why this is a gem" tooltip / per-poster stat display → post-M2, PM has
  explicitly ruled it out for this milestone.
- Continuous obscurity slider → post-M2, only if the 4 stops prove coarse.

**Testing gate — hard**
Per `CLAUDE.md`'s Testing section: "the hidden-gem scoring function… gets
unit tests before M2 is considered done, not after." `tests/lib/hidden-gem.test.ts`
must cover, at minimum: `weightedRating` against a hand-computed row;
`computeStats` on an odd- and even-length sample (median edge cases);
`isHiddenGem` boundary cases for the WR threshold, both vote-count band
edges, and the popularity < median edge. Route-level tests are not in scope
for the M2 gate — the formula is where silent breakage is most likely and
therefore where the tests belong.
