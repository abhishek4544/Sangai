# M2 — Hidden-gem toggle

**Status:** In progress
**Milestone:** M2
**Owner:** Product

## Problem statement

Every competing "what should we watch" surface — TwoSeven, SyncUp, Parsec,
even the streamer home screens — collapses to the same handful of trending
titles. CLAUDE.md names this as the moat: nobody else scores for "good but
under-seen". M2 puts that scoring on the picker as a toggle, so a single tap
flips the M1 shortlist from "popular in this genre" to "hidden gems in this
genre" — using the weighted-rating formula locked in CLAUDE.md, not vibes.

## User story

**As a** viewer who is bored of the same trending titles,
**I want to** flip a "hidden gems" toggle on my chosen genre and pick how
obscure I want to go
**so that** I get well-rated films most people haven't seen, instead of the
same top-of-charts list every other app shows me.

## Scope (what M2 must do)

- Add a **hidden-gems switch** on `/`, positioned beside/above the M1 chip
  row. Default OFF.
- The switch is **only interactable once a genre chip is selected** — before
  that it is visible but disabled (gems are genre-scoped in M2).
- When ON, reveal a **4-stop segmented control** for obscurity:
  **Mainstream / Mixed / Underground / Deep cut**. Default stop when the
  switch is first turned on: **Underground**.
- Toggling ON, toggling OFF, or changing the obscurity stop each fires
  **exactly one** request and replaces the current results.
  - ON  → `/api/movies/gems?genre=<id>&obscurity=<0..3>`
  - OFF → the existing M1 `/api/movies/discover?genre=<id>` behavior
- All gem scoring runs server-side per the CLAUDE.md formula. The client
  never sees `vote_count`, `WR`, or thresholds — only the resulting poster
  list plus loading / empty / error states.
- Show loading, empty, and error states in the results area (empty state
  copy is gem-specific — see AC4).

## Acceptance criteria

### AC1 — Toggle ON, default obscurity
**Given** the user has selected the "Horror" chip and results are showing
**When** they flip the hidden-gems switch to ON
**Then** exactly one request goes to
`/api/movies/gems?genre=27&obscurity=2` (Underground is stop index 2), the
segmented control is revealed with "Underground" selected, and every rendered
poster corresponds to a movie the server has confirmed satisfies **all three**
gates from the CLAUDE.md formula: `WR >= 7.2` AND `vote_count` inside the
current obscurity band AND `popularity < genre_median` for the sampled set.

### AC2 — Toggle OFF returns to M1 behavior
**Given** the hidden-gems switch is ON with results showing
**When** the user flips the switch OFF
**Then** exactly one request goes to
`/api/movies/discover?genre=<id>&sort_by=popularity.desc` (the M1 endpoint,
unchanged), the segmented control is hidden, and the results area is
replaced with the standard M1 popularity-ordered shortlist.

### AC3 — Changing obscurity stop
**Given** the switch is ON with results showing at "Underground"
**When** the user selects "Deep cut" on the segmented control
**Then** exactly one new request fires with `obscurity=3`, the previous
results are replaced (not appended), and the newly selected stop is the only
one visually marked as active.

### AC4 — Empty gems result (do NOT fall back to popular)
**Given** the user has picked a genre and turned the switch ON at some
obscurity stop
**When** the server returns zero movies satisfying all three gates
**Then** the results area shows the copy
**"Nothing quite that obscure in this genre — try a milder setting."** and
renders no posters. The client must **not** silently fall back to the M1
popular list; the empty state is the correct answer.

### AC5 — Switching genre while gems are ON
**Given** the switch is ON at "Mixed" with results showing for "Horror"
**When** the user taps the "Comedy" chip
**Then** exactly one request goes to
`/api/movies/gems?genre=35&obscurity=1`, the switch stays ON, the segmented
control stays on "Mixed", and results are replaced.

### AC6 — TMDB / gems endpoint failure
**Given** the switch is ON and the user has picked a genre (or changed a
stop)
**When** `/api/movies/gems` returns 4xx/5xx or the network fails
**Then** the results area shows the **same generic** copy the M1 picker uses
("The movie service is temporarily unavailable, please try again"), no raw
error / URL / key / formula internals are exposed to the client, the failure
is logged server-side, and the user can retry by re-toggling, re-selecting a
stop, or picking another genre.

### AC7 — a11y: switch and segmented control
**Given** the user is on `/` navigating by keyboard and/or a screen reader
**When** they Tab through the picker
**Then**
- the hidden-gems toggle exposes `role="switch"` with `aria-checked` reflecting
  its state and is operable via Enter/Space;
- the obscurity control is either a `role="radiogroup"` or a native
  `<fieldset>` with grouped radio inputs, has an accessible group label
  ("How obscure?"), and left/right arrow keys move selection between the 4
  stops (wrapping is not required);
- the results region continues to have `aria-live="polite"` as inherited from
  M1 so screen readers announce when the list is replaced.

## Out of scope (explicit — do not build in M2)

- **Continuous obscurity slider.** M2 ships the 4-stop segmented control
  only. A continuous slider is deferred until the discrete stops are shown
  to be too coarse in real usage.
- **"Gems across all genres" mode.** Gems require a selected genre. No
  cross-genre or all-genres gem browsing in M2.
- **Per-user gem history / "already seen" filtering.** No user accounts in
  M2 — there is nothing to remember.
- **"Why this is a gem" tooltip or per-poster stat display.** The client
  intentionally does not see `WR`, `vote_count`, or the genre median. Ship
  it opaque; consider revealing stats after real users ask.
- **Tuning the `WR >= 7.2` threshold through the UI.** The threshold is a
  server constant per CLAUDE.md until we have data to move it.
- **Multi-genre gem queries, era/mood/keyword secondary filters, shuffle,
  shared rooms, video call** — all downstream milestones.

## Success metric

**Primary — we are actually surfacing under-seen titles.**
For each of the 10 M1 genres, the **median `vote_count` of results returned
by `/api/movies/gems`** (at any obscurity stop) must be **less than the
25th percentile of `vote_count`** in the unfiltered `/api/movies/discover`
result for the same genre. Measured offline over a fixed evaluation snapshot;
this is the "not just popular" gate.

**Coverage gate — the feature can't return nothing most of the time.**
Across the cross-product of the 10 M1 genres × the two most-used obscurity
stops (**Underground**, **Mixed**), **at least 80%** of the 20 combinations
must return **>= 1 gem**. If coverage drops below 80%, the vote-count band
for the failing stops is the first knob to revisit (server-side, per
CLAUDE.md — never hardcoded on the client).

**Secondary (watch, don't gate on):** median time from switch-flip → first
poster paint under 2.0s on a warm cache. Slightly looser than the M1 1.5s
budget because gems requires a ~60-movie sample (3 TMDB pages) to compute
`C` and the genre median.

## Open questions

1. **Vote-count bands per stop.** Proposed starting bands (server constants):
   Mainstream `[2000, ∞)`, Mixed `[500, 2000)`, Underground `[100, 500)`,
   Deep cut `[50, 100)`. These stay inside the CLAUDE.md `50..2000` envelope
   but the split points are a guess — is there a better initial split before
   we have usage data?
2. **Default obscurity when the switch is first flipped ON.** Locked as
   Underground in this spec on the assumption that Mainstream defeats the
   whole point and Deep cut risks empty states — worth revisiting after the
   coverage gate is measured for real.
3. **Cache TTL for the gems sample.** The 60-movie sample per (genre,
   obscurity) is the expensive part. Short TTL keeps results fresh; long TTL
   keeps costs and latency down. Suggest 6h to start — needs an actual
   number before implementation.
4. **Does the switch state persist across genre switches within a session?**
   AC5 says yes (the switch stays ON when moving Horror → Comedy). Confirm
   this is the desired behavior vs. resetting the switch on every new genre
   pick.
