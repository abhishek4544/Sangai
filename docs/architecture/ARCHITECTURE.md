# Movie Night — Architecture

Living overview. Update in the same commit as the change that dates it.

## Current MVP architecture — W-MVP (post-pivot 2026-09-04)

The active MVP is the **watch-together room**, not the recommender. Full
design in [ADR 0004 — Watch-together on LiveKit Cloud, no DB](./adr/0004-watch-together-livekit.md).
Short version:

- **Room + media:** LiveKit Cloud (SFU + TURN + screen-share-with-audio
  + voice). Managed. No hand-rolled WebRTC.
- **Room existence:** LiveKit itself is the source of truth. A room
  exists iff a LiveKit room with that name exists. **No database.**
- **Auth:** anonymous. The 6-char room code (31-char alphabet,
  `crypto.randomBytes`, ~887M combinations) IS the capability token.
  Nicknames are display-only, never trusted.
- **Backend:** two Next.js API routes on Vercel — `POST /api/rooms`
  (create + mint host token) and `POST /api/rooms/[code]/join` (verify
  room exists on LiveKit + mint guest token). **Node runtime**, not
  Edge — LiveKit server SDK requires Node crypto.
- **Frontend:** `/` (landing, no LiveKit SDK loaded) and
  `/room/[code]` (LiveKit UI, `livekit-client` **lazy-loaded**).
- **Env:** `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
  validated by `src/lib/env.ts`.
- **Rate limiting:** per-IP on create, per-(IP, code) on join; brute-
  force math + threat model live in ADR 0004.
- **DRM:** Netflix / Prime / Disney+ / HBO Max render as a black frame
  on the guest side — browser DRM restriction, not a bug. Warned in
  the UI (AC7).

The recommender routes (`/api/movies/discover`, `/api/movies/gems`) and
their libraries remain in the repo but are **parked** — no active
milestone touches them until W-MVP ships. The section below documents
their state at M2 for reference.

---

## Long-term recommender architecture (parked)

## Stack (locked)

Source of truth is the table in `CLAUDE.md`. Reproduced here for orientation, not for editing — edit `CLAUDE.md` and mirror.

- **Frontend:** Next.js (App Router) + TypeScript strict, Tailwind CSS.
- **API:** Next.js route handlers (Node runtime). All third-party calls (TMDB, later OMDb) are server-side only.
- **Database:** Postgres (Neon/Supabase) via **Prisma**. Not introduced until M4.
- **Cache / pub-sub:** Redis (Upstash). Not introduced until M4.
- **Room sync:** Socket.IO on a small always-on host (Fly.io/Railway). M4.
- **Video call:** LiveKit Cloud. M5.
- **Hosting:** Vercel (app) + Fly.io/Railway (Socket.IO).

Notes on things the default tech-lead template suggests but this project has explicitly rejected: **no Drizzle** (Prisma is locked), **no shadcn/ui** (Tailwind primitives only). See `CLAUDE.md`.

## Current state — after M2

### Routes

| Path | Method | Purpose | Notes |
|---|---|---|---|
| `/` | GET | Genre picker + hidden-gems toggle + 4-stop obscurity control + results grid. | Client component; calls `/api/movies/discover` when the toggle is OFF and `/api/movies/gems` when the toggle is ON. |
| `/api/movies/discover` | GET | TMDB `/discover` proxy. | Zod-validates every query param (genre whitelisted to `TMDB_GENRE_IDS`). Server-only fetch. Unchanged since M1. |
| `/api/movies/gems` | GET | Hidden-gem endpoint. Samples 3 TMDB pages in parallel, computes `C` + genre-median popularity, filters via the CLAUDE.md formula, caps at 20 posters. | `genre` + `obscurity` (`0..3`) validated via Zod. In-memory `Map` cache, TTL 5min, FIFO cap 128. Response: `{ results, stats, obscurity }`. |

### Libraries (`src/lib`)

| File | Purpose | I/O? |
|---|---|---|
| `env.ts` | Zod-validated env schema; fails loudly at boot on missing keys. | No |
| `tmdb.ts` | `discoverMovies`, `TmdbError`, `DiscoverParams`, `Movie`, `posterUrl`. `MovieSchema` includes `popularity` as of M2. Server-only. | Yes (TMDB) |
| `hidden-gem.ts` | Pure formula module. `weightedRating`, `computeStats`, `isHiddenGem`, `GEM_THRESHOLD`, `M_VOTE_FLOOR`. No I/O, no `server-only` (safe under Vitest). | No |

No `intent.ts`, no `/api/chat`, no `rate-limit.ts` — M1 was revised to a click-only picker before those landed.

### Cross-cutting

- **Logging:** `TmdbError`s log class + upstream status only, never the request URL (which carries the API key). No PII in logs.
- **Rate limiting:** none in M1. Added in M4 when Redis lands. Tracked in `docs/architecture/tech-debt.md`.
- **Secrets:** `TMDB_API_KEY` etc. live in `.env.local`, validated by `src/lib/env.ts`, never reach the client.

### What is NOT here yet

- Postgres / Prisma — M4.
- Redis — M4 (shared rate limiting + room state land together; also
  replaces the M2 in-memory gems cache).
- Socket.IO service — M4.
- LiveKit — M5.
- Free-text chat / intent parsing — out of scope; picker replaced it.

## ADRs

- [0002 — M1 genre picker](./adr/0002-m1-genre-picker.md)
- [0003 — M2 hidden-gem toggle](./adr/0003-m2-hidden-gem.md)
- [0004 — W-MVP watch-together on LiveKit Cloud, no DB](./adr/0004-watch-together-livekit.md)
