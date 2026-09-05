# Roadmap

Living doc. One milestone per session per CLAUDE.md build order. Update
status in the same commit as the work.

> **Pivot — 2026-09-04.** Active path is the **watch-together room MVP**
> (W-MVP). The movie-recommender milestones (M2–M5) are **parked** — the
> code stays in the repo, the milestones are off the active path until
> W-MVP ships. See `CLAUDE.md` for the pivot note and `features/watch-
> together-mvp.md` for the current spec.

## Active — watch-together MVP

| ID | Milestone | Status |
|---|---|---|
| W-MVP | Watch-together room: create/join by code, LiveKit voice + video, host tab-share with audio (see `features/watch-together-mvp.md`) | In progress |

## Parked — original movie-recommender path

| ID | Milestone | Status |
|---|---|---|
| M0 | TMDB proxy API route + plain movie grid | Done |
| M1 | Genre picker (10 chips) → `/discover` call → results | Done |
| M2 | Hidden-gem toggle (weighted-rating formula) | Parked |
| M3 | Shuffle | Parked |
| M4 | Shared room (Socket.IO) + joint filters + synced shuffle | Parked |
| M5 | Video call layer (LiveKit) | Superseded by W-MVP |

## Notes

- Each milestone gets its own PM spec under `docs/product/features/`.
- Non-goals for W-MVP (DRM playback, playback state sync, moderation,
  recording, mobile-optimized layouts, text chat) are locked in the W-MVP
  spec — do not re-open them on the roadmap.
- Non-goals from the original path (DRM sync, screen-share playback for
  the recommender, general watch-party parity) also still hold from
  `CLAUDE.md` — parked, not deleted.
- Free-text chat and LLM-based intent parsing remain out of scope for M1
  and are not resurrected by the pivot.
- Recommender work is off the active path until W-MVP ships. New PM specs
  for parked milestones should not be written before then.
