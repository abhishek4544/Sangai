# Movie Night — Project Memory

This file is read automatically by Claude Code at the start of every session in
this repo. It exists so decisions don't get re-litigated and so security and
performance are defaults, not afterthoughts bolted on later. Keep it current —
when a decision below changes, edit this file in the same commit.

> **PIVOT — 2026-09-04.** The MVP is no longer the movie-recommender. It is a
> **watch-together room product**: create a room, get a shareable code, invite
> friends anonymously, LiveKit voice + video call, host screen-shares a browser
> tab with audio. The recommender/hidden-gem/shuffle work is **parked** (code
> stays, milestones don't). See "Current MVP" below; the long-term vision
> section is retained for context but not the active plan.

## Current MVP (post-pivot)

1. Host visits `/` → clicks **Create room** → gets a short, shareable **room code**.
2. Host sends the code to friends / girlfriend out-of-band (DM, SMS, whatever).
3. Anyone with the code visits `/`, enters it, picks a nickname, joins.
4. In `/room/[code]`: LiveKit voice + video between all participants, PLUS
   **any participant** can **screen-share a browser tab with its audio**
   (YouTube, Twitch, live sports, X videos, any non-DRM site). One share at
   a time — the UI disables the Share button while someone else is sharing.
   Product change 2026-09-05: originally host-only per ADR 0004; opened up
   so guests can share too. ADR 0004 is not amended (frozen); the code is
   the source of truth for this switch.
5. Everyone hears the shared stream's audio in real-time, alongside voice chat.

**Explicit trade-offs locked with the user:**
- **DRM sites (Netflix, Prime, Disney+, HBO Max) will show a black frame on
  the remote side.** This is a browser-level DRM restriction. Don't try to
  bypass it. Users are told upfront in the UI.
- LiveKit path chosen over Hyperbeam (cloud co-browser) for MVP: free-tier
  feasible, no per-hour cost. Hyperbeam stays on the table if DRM support
  becomes a requirement.
- Anonymous share-link, no accounts. Room code IS the capability token.
- No DB for the MVP — LiveKit is the source of truth for room existence.

## Long-term product vision (parked, NOT the active MVP)

The original project is a chat-based movie recommender with hidden-gem scoring
and a joint-filter shuffle mode. That code (TMDB proxy, hidden-gem formula,
`/api/movies`) stays in the repo but is off the active milestone path until
the watch-together MVP ships. Non-goals from the original spec still hold:
we are not a DRM-sync engine, not a Parsec/Teleparty clone.

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

## Tech stack (locked for the MVP — don't introduce a new layer without updating this table)

| Layer | Pick | Notes |
|---|---|---|
| Frontend | Next.js (App Router) + TypeScript, Tailwind CSS | Strict mode on. Lazy-load the LiveKit SDK — don't ship it on the landing page. |
| API layer | Next.js API routes (serverless) | Token mint is stateless — serverless is fine for the MVP. |
| Room + media | **LiveKit Cloud** (SFU + TURN + screen-share with audio + voice) | One managed service, do not hand-roll WebRTC signaling or TURN. |
| Room existence | **LiveKit itself** — no DB for the MVP | Codes are ephemeral; a room exists iff there's a LiveKit room with that name. |
| Auth | Anonymous — the room code IS the capability token | No accounts. Nickname is display-only, never trusted. |
| Hosting | Vercel | Single deploy target for the MVP. |

**Parked stack (for the long-term recommender, do not add for the MVP):**
Redis / Postgres / Prisma / Socket.IO / Fly.io / TMDB / OMDb. The files that
already exist for these stay; don't extend them until the MVP is out.

## Build order — MVP watch-together rooms

Ship in this sequence. Milestones are tracked in the task list, not here.

1. **W0** — PM MVP scope doc (`docs/product/features/watch-together-mvp.md`)
2. **W1** — Tech-lead ADR: LiveKit + code generation + no-DB decision
3. **W2** — DevOps: LiveKit Cloud env vars, `env.ts` schema update
4. **W3** — Backend: `POST /api/rooms` (create), `POST /api/rooms/[code]/join` (mint token)
5. **W4** — Frontend: `/` (create + join-by-code), `/room/[code]` (LiveKit UI)
6. **W5** — QA (two-browser E2E) → Security review → Code review → merge

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

- **LiveKit Cloud account** — need `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
  `LIVEKIT_API_SECRET`. Blocks W3 (backend can't mint tokens without them).
- User expectations doc — the UI must state upfront that Netflix/Prime/
  Disney+/HBO won't work via screen-share so nobody files it as a bug.
- TMDB API key — no longer blocks anything; the recommender is parked.
- Teleparty and Rave — deferred with the recommender.
