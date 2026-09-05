# M1 — Genre picker → Discover

**Status:** In progress
**Milestone:** M1
**Owner:** Product

## Problem statement

Browsing a bare popularity grid (M0) doesn't help someone answer "what should
we watch tonight?" — the user comes in with an intent, not a ranked list. M1
gives them one question with clickable answers, so a single tap resolves to a
relevant shortlist without teaching them TMDB's filter UI.

## User story

**As a** solo viewer picking a film for the evening,
**I want to** pick a genre from a small set of on-screen options
**so that** I get a shortlist of that genre with one tap — no typing, no
menus, no free-text guessing.

## Scope (what M1 must do)

- Replace the M0 popularity grid on `/`. The grid is gone — it was
  scaffolding for the data layer.
- Show one question ("What are you in the mood for?") and a row of
  clickable **genre chips** (10 chips, whitelisted TMDB genre IDs).
- Tapping a chip fires exactly **one** call to `/api/movies/discover?genre=…`
  and renders the resulting posters below.
- Selected chip is visually marked. A "Pick another" affordance resets the
  selection and clears the results area.
- Show loading, empty, and error states for the results area.

## Acceptance criteria

### AC1 — Happy path
**Given** the user is on `/`
**When** they tap the "Horror" chip
**Then** exactly one request goes to
`/api/movies/discover?genre=27&sort_by=popularity.desc`, the chip becomes the
selected chip, and at least one poster renders below within 2 seconds on a
warm cache.

### AC2 — Switching genres
**Given** the user has already picked "Horror" and results are showing
**When** they tap "Comedy"
**Then** exactly one new request goes with `genre=35`, the previous results
are replaced (not appended), and the selected-chip indicator moves to
"Comedy".

### AC3 — Empty result set
**Given** the user picks a genre and TMDB legitimately returns zero results
**When** the response resolves
**Then** the results area shows a short "No matches — try another genre"
message, not an error state.

### AC4 — TMDB failure
**Given** the user picks a genre
**When** `/api/movies/discover` returns 4xx/5xx or the network fails
**Then** the results area shows a plain "The movie service is temporarily
unavailable, please try again" message, no raw error / URL / key is exposed
to the client, the failure is logged server-side, and the user can tap the
same or a different chip to retry.

### AC5 — Keyboard + a11y
**Given** the user is on `/`
**When** they Tab through the page
**Then** each chip is a focusable `<button>`, Enter/Space activates it, the
selected chip has `aria-pressed="true"`, and the results region has
`aria-live="polite"` so screen readers announce updates.

## Out of scope (explicit — do not build in M1)

- **Free-text chat input / intent parser / LLM.** The picker replaces the
  entire "type what you want" surface. Adding a text input is a separate
  post-M1 decision.
- **Multi-select / genre combinations** (Horror + Comedy). One genre per
  turn in M1.
- **Era, mood, or vibe filters.** Genre only in M1. Secondary filters are a
  follow-up.
- **Hidden-gem toggle / scoring** — M2.
- **Shuffle** — M3.
- **Shared rooms, joint filters, synced state** — M4.
- **Video call layer** — M5.
- **Real streaming availability (JustWatch etc.)** — deferred per CLAUDE.md.
- **User accounts, saved picks, history persistence.**

## Success metric

**Primary:** ≥ 95% of chip taps resolve to ≥ 1 rendered poster (parser is
gone, so the only failure modes are network / TMDB). Measured server-side by
existing `/api/movies/discover` request logs plus `results_count`.

**Secondary (watch, don't gate on):** median time from tap → first poster
paint under 1.5s on a warm cache.

## Open questions

1. **Which 10 genres ship as chips?** Proposed seed set: Action, Comedy,
   Horror, Sci-Fi, Romance, Thriller, Drama, Documentary, Family, Animation.
   TMDB has 19 total — the other 9 (Adventure, Crime, Fantasy, History,
   Music, Mystery, TV Movie, War, Western) are omitted for chip-row real
   estate. Revisit if usage suggests one of the omitted 9 belongs.
2. **Chip ordering** — alphabetical, or a curated "most-picked-first" order?
   Recommend alphabetical for v1 (no usage data yet).
3. **Default state** — empty results area with just a prompt, or auto-load
   Popular on first visit? Recommend empty with prompt — the "one question"
   design breaks if the page pre-answers itself.
