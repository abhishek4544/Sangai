# Movie Night — Project Memory

This file is read automatically by Claude Code at the start of every session in
this repo. It exists so decisions don't get re-litigated and so security and
performance are defaults, not afterthoughts bolted on later. Keep it current —
when a decision below changes, edit this file in the same commit.

## What we're building

A chat-based movie recommender: ask for a genre, a mood, or a scene theme, get
a shortlist — including a "hidden gem" mode that surfaces good, under-seen
titles. A second mode lets two people, long-distance, share a link, set their
own filters, and shuffle to a pick that satisfies both, then watch together
with a live video call running alongside.

**Non-goals** — said explicitly so nobody re-proposes them later:
- Not a DRM-sync engine. TwoSeven and SyncUp have spent years on
  Netflix/Disney+/HBO playback sync — competing there is a bad use of time.
  Watch-together stays light: shared filters + shuffle, open-web sources only,
  for now.
- Not a general-purpose watch-party clone. The product's edge is the
  *decision* layer (chat, mood, hidden gems) — every competitor we looked at
  is silent there. Don't dilute that by chasing feature parity on sync.
- Not screen-sharing for playback. It re-encodes video in real time and adds
  real lag (this is Parsec's actual weakness) — see Architecture below for the
  approach that avoids it.

## Product decisions already made

| Decision | Answer | Why |
|---|---|---|
| Movie data source | TMDB primary, OMDb secondary | Netflix has no public catalog/ratings API — only a twice-yearly disclosed-titles report. TMDB gives `vote_average`, `vote_count`, `popularity`, genres, keywords. |
| JustWatch (real streaming availability) | Deferred | Enterprise/sales-contact only, no self-serve key — not a day-one dependency. |
| Watch-together transport | Shared link/room, state-sync (timestamps), not screen-share | Screen-share adds a full extra video encode/decode hop; state-sync sends a tiny "position: 14:32.5" message instead. |
| Video/audio call | Separate WebRTC connection, managed SDK | Independent of playback sync; a solved problem, don't hand-roll TURN infra. |
| Positioning | Own the "what should we watch" layer | Zero competitors (TwoSeven, SyncUp, Parsec) do genre/mood discovery or hidden-gem scoring. That's the moat. |

**Hidden-gem formula** (IMDb-style weighted rating + a popularity ceiling):

```
WR = (v / (v + m)) * R + (m / (v + m)) * C

is_gem = WR >= 7.2
     AND vote_count BETWEEN 50 AND 2000
     AND popularity < genre_median
```
`v` = vote_count, `R` = vote_average, `m` = minimum-votes threshold (tune this),
`C` = mean vote_average across the current filter set. Expose the vote-count
floor/ceiling as one "how obscure" slider — never hardcode it.

## Tech stack (locked — don't introduce a new layer without updating this table)

| Layer | Pick | Notes |
|---|---|---|
| Frontend | Next.js (App Router) + TypeScript, Tailwind CSS | Strict mode on. |
| API layer | Next.js API routes → small Node/Fastify service once it outgrows serverless | All third-party calls (TMDB, OMDb) go through here — never called from the browser. |
| Movie data | TMDB, server-proxied, Redis-cached | Cache `/discover` results by parameter set for hours, not seconds. |
| Cache / pub-sub | Redis (Upstash to start) | Also carries room presence and shuffle-sync signals. |
| Database | Postgres (Neon/Supabase) via Prisma | Rooms, saved filters, users. |
| Room sync | Socket.IO on a small always-on host (Fly.io/Railway) | Needs a persistent connection — doesn't belong on serverless. |
| Video call | LiveKit Cloud (or Daily/Twilio Video) | Managed TURN + reconnection handling — don't hand-roll WebRTC signaling. |
| Hosting | Vercel (app) + Fly.io/Railway (Socket.IO) | Two small pieces, not one monolith. |

## Build order

Ship in this sequence. Each milestone is its own session/prompt — don't ask
for more than one at a time.

1. **M0** — TMDB proxy API route + plain movie grid (proves the data layer)
2. **M1** — chat → genre/mood → `/discover` call → results
3. **M2** — hidden-gem toggle using the formula above
4. **M3** — shuffle
5. **M4** — shared room (Socket.IO) + joint filters + synced shuffle
6. **M5** — video call layer (LiveKit)

## Engineering standards

Treat these as defaults, not suggestions to revisit per-feature.

**Secrets & config**
- TMDB/OMDb keys, DB URLs, and Redis URLs live in `.env.local`, are
  `.gitignore`d, and are never referenced from client-side code — only from
  API routes / server components.
- Validate env vars at boot with a schema (e.g. `zod`) so a missing key fails
  loudly on startup, not silently on first request.
- No secret ever appears in a log line, an error message returned to the
  client, or a commit.

**Input handling**
- Every value that reaches an API route from the client (chat text, filter
  params, room codes) is validated and sanitized server-side before it
  touches TMDB, the database, or another user's session. Never trust a
  client-supplied genre/keyword ID — validate against the known TMDB ID set.
- Room codes are generated server-side with a cryptographically random
  source, not `Math.random()`, and carry enough entropy that guessing one
  isn't practical. Treat a room code as a capability token, not an identity —
  don't assume knowing it proves who someone is.
- Chat text rendered back to other users is escaped/sanitized — this is a
  shared multi-user surface, treat it like any other XSS vector.

**Abuse & cost protection**
- Rate-limit the TMDB proxy per session/IP. It protects the request quota and
  prevents a runaway client (or a bad actor) from generating real cost.
- Cache before you call. A repeated "moody heist film" query should hit Redis,
  not TMDB, on the second request.

**Dependencies & supply chain**
- Keep `npm audit` / Dependabot on and actually act on what it flags,
  especially for anything touching WebRTC or video — that's a bigger attack
  surface than the rest of the app combined.
- Pin versions for anything security-sensitive; avoid adding a package for
  something a few lines of code would do.

**Least privilege**
- Database roles/connection strings are scoped to what each service actually
  needs — the Socket.IO room service shouldn't hold the same DB credentials
  as the main app if it doesn't need to.
- The video-call layer only receives a room token scoped to that one room and
  session, not a broad credential.

**Performance**
- Server-render or statically generate whatever doesn't need to be
  client-rendered.
- Lazy-load the LiveKit/video SDK — it should not ship in the bundle for
  pages that never open a call.
- Movie posters/backdrops load from TMDB's own CDN via `next/image` — never
  proxy or re-host images.
- One `/discover` call per chat turn, not a waterfall of sequential requests.

**Observability**
- Structured logs; errors go to a tracker (e.g. Sentry) from the first
  milestone, not bolted on later — silent failures are worse than loud ones.
- No PII or secrets in logs, ever.

**Testing**
- The hidden-gem scoring function and the chat→filter intent mapping are the
  two places most likely to silently break (per our own research — mood
  language is fuzzy, thresholds are easy to get subtly wrong). Both get unit
  tests before M2/M1 are considered done, not after.

## Open items

- TMDB API key — not yet obtained; blocks M0.
- Build path — prototype-first on the stack above, not yet confirmed against
  a straight-to-production build.
- Teleparty and Rave — flagged as closer direct competitors than Parsec;
  not yet researched.
- JustWatch integration — deferred, revisit once real streaming-availability
  data is actually needed.
