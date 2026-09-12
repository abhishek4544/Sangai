/**
 * Phase-2 data-channel envelope. ADR 0005 §1.
 *
 * Wire format: JSON-encoded UTF-8 bytes.
 *
 *     { v: 1, ts: <unix-ms of sender>, type: "reaction" | ..., ...payload }
 *
 * - `v` is the envelope version. Peers on a different `v` drop silently
 *   (forward compat — old clients don't try to interpret new shapes).
 * - `ts` is the sender-side unix-ms. It's the last-writer-wins arbiter for
 *   room-wide state (see `state.ts`). Never trust it for wall-clock ordering.
 * - Unknown `type`s are dropped silently — same posture.
 *
 * Every inbound message is Zod-parsed before dispatch; malformed input logs
 * once and drops. Matches ADR 0004's route-validation posture.
 */

import { z } from "zod";
import { UPDATED_AT_MAX_MS } from "@/lib/watch/validate-url";

export const ENVELOPE_VERSION = 1;

// ---- Watch Mode shared field schemas (ADR 0006 / security-review H2, L2) --

/**
 * updatedAt is the LWW arbitration key for all watch/* events.
 *
 * H2 remediation (schema layer 1): bounded above at year-2100 unix-ms
 * (4_102_444_800_000). Prevents a peer stamping Number.MAX_SAFE_INTEGER to
 * permanently win every LWW comparison for the life of the room.
 * Layer 2 (runtime skew cap) is enforced by isWatchEventFresh() in
 * src/lib/watch/validate-url.ts — call it after Zod parse in useWatchSync.
 */
const WatchUpdatedAt = z.number().int().min(0).max(UPDATED_AT_MAX_MS);

/**
 * positionSec is the playhead position in seconds.
 *
 * L2 remediation: capped at 86 400 s (24 hours). YouTube videos longer than
 * that do not exist; the cap prevents a malformed seek from passing an
 * implementation-defined value to player.seekTo().
 */
const WatchPositionSec = z.number().nonnegative().max(86_400);

/**
 * mediaId for the YouTube provider: exactly 11 chars from [A-Za-z0-9_-].
 * Validated at publish time by validateWatchUrl(); re-validated on receive
 * so a malicious peer cannot inject an arbitrary string.
 */
const WatchMediaId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);

// ---- Payload shapes ------------------------------------------------------

/** AC5.1 — a single reaction fires with an emoji, a sender-visible name, and
 *  a stable id so the receiver can dedupe if the LOSSY channel duplicates. */
const ReactionSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  ts: z.number().int().nonnegative(),
  type: z.literal("reaction"),
  emoji: z.string().min(1).max(8),
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  /**
   * "Burst" size. Optional so old peers (no `count` field) still decode; they
   * simply render one floater as before. Bounded so a malicious/broken sender
   * can't turn one click into an OOM on the receiver. Overlay staggers the
   * spawn so 1000 emojis feel like reaction-rain, not a frame drop.
   */
  count: z.number().int().min(1).max(1000).optional(),
});

/** AC1.x — hold state is single-writer-wins by `ts`. Payload carries the
 *  next-state, not a delta: `held=true` with initiator identity + display
 *  name; `held=false` to release. Peers derive the banner from state. */
const HoldSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  ts: z.number().int().nonnegative(),
  type: z.literal("hold"),
  held: z.boolean(),
  by: z.string().min(1).max(128).optional(),
  byName: z.string().min(1).max(64).optional(),
});

/** AC4.x — whisper has two shapes on the same channel:
 *  - `toggle`: room-wide on/off. RELIABLE (see ADR §1 reliability table).
 *  - `voice-on` / `voice-off`: local VAD edges, broadcast so peers duck in
 *    sync. LOSSY; a missed edge self-heals on the next one. */
const WhisperSchema = z.discriminatedUnion("phase", [
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("whisper"),
    phase: z.literal("toggle"),
    on: z.boolean(),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("whisper"),
    phase: z.literal("voice-on"),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("whisper"),
    phase: z.literal("voice-off"),
  }),
]);

/** AC6.x — cards. `propose` is the room-wide LWW event; `dismiss` clears
 *  the current card; `toggle` sets the feature on/off room-wide. */
const CardSchema = z.discriminatedUnion("phase", [
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("card"),
    phase: z.literal("propose"),
    id: z.string().min(1).max(64),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("card"),
    phase: z.literal("dismiss"),
    id: z.string().min(1).max(64),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("card"),
    phase: z.literal("toggle"),
    on: z.boolean(),
  }),
]);

/** Product ask 2026-09-05: when someone else is sharing, another participant
 *  can *ask* for the spot instead of being passively blocked. Targeted
 *  (not broadcast) — `destinationIdentities` is set to the current sharer
 *  at send time, so uninvolved participants don't see the toast. Payload
 *  carries the requester's display name; the requester's identity comes
 *  through the LiveKit `DataReceived` participant argument. RELIABLE —
 *  a lost request feels like a broken button. */
/** Chat message (product ask 2026-09-05). Broadcast (no `destinationIdentities`),
 *  RELIABLE — a lost message reads as a broken feature. Text is capped at
 *  500 chars server-side so an oversized payload can't flood the channel;
 *  the client-side input caps at the same limit. Sender name inline for
 *  rendering; identity comes via the `DataReceived` participant arg. */
const ChatSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  ts: z.number().int().nonnegative(),
  type: z.literal("chat"),
  text: z.string().min(1).max(500),
  name: z.string().min(1).max(64),
});

/** "Look at Me" — sender broadcasts, every peer dims their UI except the
 *  sender's participant tile, ~4 s auto-clear. Product ask 2026-09-05.
 *  Broadcast (no `destinationIdentities`), RELIABLE. Payload carries the
 *  sender's name for the spotlight label; identity comes via the
 *  `DataReceived` participant arg. */
const LookAtMeSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  ts: z.number().int().nonnegative(),
  type: z.literal("lookAtMe"),
  name: z.string().min(1).max(64),
});

/** Movie Picker — "tonight's pick" wizard. Two partners each pick their top
 *  N by TMDB search, then one shuffles → landed movie wins. All events flow
 *  through the subscribe path (no room-state field). RELIABLE — every event
 *  (open, step change, pick, shuffle result) is user-visible and must not
 *  be lost. Serialized movie carries the minimum needed to render a poster
 *  card without a round-trip to TMDB. */
const PickerMovieSchema = z.object({
  id: z.number().int(),
  title: z.string().min(1).max(200),
  posterPath: z.string().nullable(),
  releaseDate: z.string().nullable().optional(),
});
const MoviePickerSchema = z.discriminatedUnion("phase", [
  // NB: open/close intentionally NOT here — the picker is opened/closed via
  // the shared `game.open`/`game.close` path with id "movie-picker" so it
  // slots into the couple-games right-column panel exactly like a game.
  // Genre step was removed 2026-09-06 — felt like friction; picker jumps
  // straight to search + pick 3 each.
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("moviePicker"),
    phase: z.literal("step"),
    step: z.number().int().min(0).max(2),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("moviePicker"),
    phase: z.literal("add"),
    by: z.string().min(1).max(128),
    movie: PickerMovieSchema,
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("moviePicker"),
    phase: z.literal("remove"),
    by: z.string().min(1).max(128),
    movieId: z.number().int(),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("moviePicker"),
    phase: z.literal("shuffle-result"),
    movieId: z.number().int(),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("moviePicker"),
    phase: z.literal("reset"),
  }),
  // Product ask 2026-09-06: default is 3 each but couples want control —
  // some people can barely name one, others want a bigger shuffle pool.
  // Bounds are practical (1–10); the picker UI stays snappy up to 10 each.
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("moviePicker"),
    phase: z.literal("picks-per-person"),
    count: z.number().int().min(1).max(10),
  }),
]);

/** Movie Trivia — 10 questions per round, both peers answer independently.
 *  All events flow through the subscribe path (no room-state field). Both
 *  peers stay in sync via ordered `answer` / `next` / `reset` events over
 *  the RELIABLE channel. */
const MovieTriviaSchema = z.discriminatedUnion("phase", [
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("movieTrivia"),
    phase: z.literal("answer"),
    questionIdx: z.number().int().nonnegative(),
    optionIdx: z.number().int().min(0).max(3),
    by: z.string().min(1).max(128),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("movieTrivia"),
    phase: z.literal("next"),
    nextIdx: z.number().int().nonnegative(),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("movieTrivia"),
    phase: z.literal("reset"),
  }),
]);

/** Emoji Charades — turn-based movie-guessing game. Deck is fixed-order on
 *  both peers, so the wire only carries `movieIdx` (int). Guesser self-
 *  validates against the shared deck (couples game, trust assumed) and
 *  broadcasts a `reveal` with `correct: true` the moment they match; the
 *  clue-giver can also broadcast `reveal` with `correct: false` to skip.
 *  RELIABLE — a lost clue/reveal/next event strands a peer on a stale round. */
const EmojiCharadesSchema = z.discriminatedUnion("phase", [
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("emojiCharades"),
    phase: z.literal("clue"),
    turn: z.number().int().nonnegative(),
    movieIdx: z.number().int().nonnegative(),
    // Emoji strings pack more bytes per char than ASCII; 120 chars is plenty
    // for a clue while capping the payload well under 1 KB.
    emojis: z.string().min(1).max(120),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("emojiCharades"),
    phase: z.literal("guess"),
    turn: z.number().int().nonnegative(),
    text: z.string().min(1).max(200),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("emojiCharades"),
    phase: z.literal("reveal"),
    turn: z.number().int().nonnegative(),
    correct: z.boolean(),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("emojiCharades"),
    phase: z.literal("next"),
    nextTurn: z.number().int().nonnegative(),
    nextMovieIdx: z.number().int().nonnegative(),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("emojiCharades"),
    phase: z.literal("reset"),
  }),
]);

/** Draw Together — real-time shared canvas. Segments are sent as one packet
 *  per drawn line-segment (from → to), coordinates normalized 0-1 so peers
 *  render at their own canvas size. LOSSY per-segment (a dropped segment
 *  leaves a tiny gap — better than blocking the drawer's next stroke on
 *  retransmission). RELIABLE for clear + prompt (must not be lost). */
const DrawSchema = z.discriminatedUnion("phase", [
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("draw"),
    phase: z.literal("segment"),
    strokeId: z.string().min(1).max(64),
    from: z.object({ x: z.number(), y: z.number() }),
    to: z.object({ x: z.number(), y: z.number() }),
    color: z.string().min(1).max(24),
    size: z.number().int().min(1).max(64),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("draw"),
    phase: z.literal("clear"),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("draw"),
    phase: z.literal("prompt"),
    id: z.string().min(1).max(64),
  }),
]);

/** Truth or Dare — per-game events, not stored in room state. Both peers
 *  derive local game state from the ordered event stream (subscribe path in
 *  use-room-channel). Reliability: RELIABLE — a lost `pick` would leave a
 *  peer looking at the wrong card. `turn` is included so late-arriving
 *  duplicates can be filtered on the receiver (turn goes only forward). */
const TruthOrDareSchema = z.discriminatedUnion("phase", [
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("truthOrDare"),
    phase: z.literal("pick"),
    turn: z.number().int().nonnegative(),
    cardType: z.enum(["truth", "dare"]),
    cardId: z.string().min(1).max(64),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("truthOrDare"),
    phase: z.literal("pass"),
    turn: z.number().int().nonnegative(),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("truthOrDare"),
    phase: z.literal("reset"),
  }),
]);

/** Would You Rather — two-player pick game. Both peers pick A or B on the
 *  same round simultaneously; the panel auto-reveals when both picks land.
 *  RELIABLE — a lost pick would strand a peer on "waiting for partner…".
 *  `roundIdx` on every event lets the receiver drop stale duplicates. */
const WouldYouRatherSchema = z.discriminatedUnion("phase", [
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("wouldYouRather"),
    phase: z.literal("pick"),
    roundIdx: z.number().int().nonnegative(),
    option: z.enum(["a", "b"]),
    by: z.string().min(1).max(128),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("wouldYouRather"),
    phase: z.literal("next"),
    nextIdx: z.number().int().nonnegative(),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("wouldYouRather"),
    phase: z.literal("reset"),
  }),
]);

/** Never Have I Ever — two-player simultaneous confession game. Both peers
 *  tap "have" or "never" on the same round; the panel auto-reveals when
 *  both answers land. RELIABLE — a lost answer would strand a peer on
 *  "waiting…". `roundIdx` on every event lets the receiver drop stale
 *  duplicates. Same shape as wouldYouRather with `answer` replacing `option`. */
const NeverHaveIEverSchema = z.discriminatedUnion("phase", [
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("neverHaveIEver"),
    phase: z.literal("answer"),
    roundIdx: z.number().int().nonnegative(),
    answer: z.enum(["have", "never"]),
    by: z.string().min(1).max(128),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("neverHaveIEver"),
    phase: z.literal("next"),
    nextIdx: z.number().int().nonnegative(),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("neverHaveIEver"),
    phase: z.literal("reset"),
  }),
]);

/** Most Likely To — both peers simultaneously point at whoever fits.
 *  `target` is "me" or "partner" from the sender's POV; the receiver flips
 *  the interpretation to their own POV at render time. Same reliable pick
 *  pattern as WYR / NHIE; `roundIdx` stale-guard. */
const MostLikelyToSchema = z.discriminatedUnion("phase", [
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("mostLikelyTo"),
    phase: z.literal("point"),
    roundIdx: z.number().int().nonnegative(),
    target: z.enum(["me", "partner"]),
    by: z.string().min(1).max(128),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("mostLikelyTo"),
    phase: z.literal("next"),
    nextIdx: z.number().int().nonnegative(),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("mostLikelyTo"),
    phase: z.literal("reset"),
  }),
]);

/** How Well Do You Know Me — turn-based multiple-choice. Two events per
 *  round: the subject broadcasts `subject-pick` (their true answer, index
 *  0-3), the partner broadcasts `guess` (their guess, index 0-3). Panel
 *  reveals when both are in. `roundIdx` stale-guard on every event.
 *  RELIABLE — a lost event strands a peer on "waiting…". */
const HowWellSchema = z.discriminatedUnion("phase", [
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("howWell"),
    phase: z.literal("subject-pick"),
    roundIdx: z.number().int().nonnegative(),
    optionIdx: z.number().int().min(0).max(3),
    by: z.string().min(1).max(128),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("howWell"),
    phase: z.literal("guess"),
    roundIdx: z.number().int().nonnegative(),
    optionIdx: z.number().int().min(0).max(3),
    by: z.string().min(1).max(128),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("howWell"),
    phase: z.literal("next"),
    nextIdx: z.number().int().nonnegative(),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("howWell"),
    phase: z.literal("reset"),
  }),
]);

/** Story Time — cooperative co-authoring game. Both peers alternate filling
 *  4 blanks on a shared story template. Wire carries the chosen option per
 *  blank; the turn owner is derived deterministically from sorted identities
 *  so both sides agree without coordination. RELIABLE — a lost fill would
 *  leave the story frozen. `roundIdx` stale-guard as usual. */
const StoryTimeSchema = z.discriminatedUnion("phase", [
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("storyTime"),
    phase: z.literal("fill"),
    roundIdx: z.number().int().nonnegative(),
    blankIdx: z.number().int().min(0).max(3),
    optionIdx: z.number().int().min(0).max(3),
    by: z.string().min(1).max(128),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("storyTime"),
    phase: z.literal("next"),
    nextIdx: z.number().int().nonnegative(),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("storyTime"),
    phase: z.literal("reset"),
  }),
]);

/** Two Truths & a Lie — turn-based text-input couples game. Author sends 3
 *  statements + lieIdx in one atomic `submit` event; guesser sends `guess`
 *  with which index they think is the lie. RELIABLE.
 *
 *  Wire honesty note (same posture as How Well): `lieIdx` travels in
 *  plaintext, so a client that peeks at raw events could see the answer.
 *  This is a two-person couples game — trust is the model. If we ever open
 *  it up to strangers we'd need commit-reveal (author sends hash first).
 *
 *  Statement cap: 140 chars each. Long enough for a real anecdote, short
 *  enough that three of them fit on a phone card. Length caps enforced on
 *  both the input and the schema so an oversized payload is dropped. */
const TwoTruthsSchema = z.discriminatedUnion("phase", [
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("twoTruths"),
    phase: z.literal("submit"),
    roundIdx: z.number().int().nonnegative(),
    statements: z.tuple([
      z.string().min(1).max(140),
      z.string().min(1).max(140),
      z.string().min(1).max(140),
    ]),
    lieIdx: z.number().int().min(0).max(2),
    by: z.string().min(1).max(128),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("twoTruths"),
    phase: z.literal("guess"),
    roundIdx: z.number().int().nonnegative(),
    guessIdx: z.number().int().min(0).max(2),
    by: z.string().min(1).max(128),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("twoTruths"),
    phase: z.literal("next"),
    nextIdx: z.number().int().nonnegative(),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("twoTruths"),
    phase: z.literal("reset"),
  }),
]);

/** Slow Down — cooperative shared-timer ritual game. Either partner taps
 *  Start and broadcasts `start` with the UTC anchor timestamp. Both peers
 *  count down from that anchor so the timer is naturally in sync. `stop`
 *  cancels early (either partner). RELIABLE — a lost start would strand
 *  one peer on the "ready" screen. Duration is content-driven, not on the
 *  wire: peers derive it from `roundIdx` via the shared deck. */
const SlowDownSchema = z.discriminatedUnion("phase", [
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("slowDown"),
    phase: z.literal("start"),
    roundIdx: z.number().int().nonnegative(),
    /** UTC millis anchor for the countdown. Bounded above at year-2100 so a
     *  malicious peer can't stamp Number.MAX_SAFE_INTEGER and freeze the
     *  timer forever (same posture as WatchUpdatedAt). */
    startAt: WatchUpdatedAt,
    by: z.string().min(1).max(128),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("slowDown"),
    phase: z.literal("stop"),
    roundIdx: z.number().int().nonnegative(),
    by: z.string().min(1).max(128),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("slowDown"),
    phase: z.literal("next"),
    nextIdx: z.number().int().nonnegative(),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("slowDown"),
    phase: z.literal("reset"),
  }),
]);

/** Couple Games — which game is currently open in the right-column panel.
 *  Room-wide LWW by `ts`. `open` sets the visible game id; `close` clears
 *  back to the tile grid. RELIABLE — a lost event would strand the panel
 *  on the wrong screen for one peer. */
const GameSchema = z.discriminatedUnion("phase", [
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("game"),
    phase: z.literal("open"),
    id: z.string().min(1).max(64),
    /** Identity of the peer who opened it. Some games (Movie Picker) gate
     *  certain steps to the opener; downstream components read
     *  `roomState.activeGameBy` for that. Optional so pre-existing peers
     *  who don't send it still decode cleanly. */
    by: z.string().min(1).max(128).optional(),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("game"),
    phase: z.literal("close"),
  }),
]);

/** TICKET-3 (Week 1) — cinema background pick. RELIABLE room-wide LWW field.
 *  `id` is a stable string from `src/lib/backgrounds.ts` (BACKGROUNDS[].id).
 *  Unknown ids on the receiving side fall back to the default in
 *  `getBackground()` — no schema-level enum so adding scenes doesn't need an
 *  envelope-version bump. */
const BackgroundSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  ts: z.number().int().nonnegative(),
  type: z.literal("background"),
  phase: z.literal("pick"),
  id: z.string().min(1).max(64),
});

const ShareRequestSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  ts: z.number().int().nonnegative(),
  type: z.literal("shareRequest"),
  name: z.string().min(1).max(64),
});

/** ADR §2 snapshot-on-join handshake.
 *  - `request`: joiner broadcasts on `RoomEvent.Connected`.
 *  - `snapshot`: peers > 500 ms in-room reply via targeted publishData with
 *    room-wide state so the joiner adopts an existing hold / whisper /
 *    cards mode without a race. `joinedAt` is the responder's own join
 *    time; ties broken by lexicographic identity at the joiner. */
const HelloSchema = z.discriminatedUnion("phase", [
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("hello"),
    phase: z.literal("request"),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("hello"),
    phase: z.literal("snapshot"),
    from: z.string().min(1).max(128),
    joinedAt: z.number().int().nonnegative(),
    held: z
      .object({
        by: z.string().min(1).max(128),
        byName: z.string().min(1).max(64).optional(),
        at: z.number().int().nonnegative(),
      })
      .nullable(),
    whisperOn: z.boolean(),
    cardsEnabled: z.boolean(),
    currentCard: z
      .object({
        id: z.string().min(1).max(64),
        at: z.number().int().nonnegative(),
      })
      .nullable(),
    // TICKET-3: nullable so older peers who don't send this field decode
    // cleanly; joiner keeps the default (`grass`) when snapshot omits it.
    backgroundId: z
      .object({
        id: z.string().min(1).max(64),
        at: z.number().int().nonnegative(),
      })
      .nullable()
      .optional(),
    // Couple Games — nullable so older peers who don't send this field
    // decode cleanly; joiner sees the tile grid until an open lands.
    activeGame: z
      .object({
        id: z.string().min(1).max(64),
        at: z.number().int().nonnegative(),
      })
      .nullable()
      .optional(),
    // Watch Mode v1.1 (ADR 0006) — late-joiner catch-up. nullable = no Watch
    // Mode active; .optional() = pre-v1.1 peers who omit this field decode
    // cleanly. Joiner treats absence and null identically (no Watch Mode).
    // Security: WatchUpdatedAt and WatchPositionSec inherit H2/L2 caps.
    // providerId is z.literal("youtube") — no arbitrary strings (review §Q4).
    watchState: z
      .object({
        providerId: z.literal("youtube"),
        mediaId: WatchMediaId,
        playbackState: z.enum(["playing", "paused"]),
        positionSec: WatchPositionSec,
        updatedAt: WatchUpdatedAt,
      })
      .optional(),
  }),
]);

/**
 * Watch Mode envelope types — ADR 0006 / W-1.1.
 *
 * Security notes baked into every schema:
 *
 * - No controllerId field in any payload (M3 remediation). The authoritative
 *   sender identity is the LiveKit DataReceived participant argument, not a
 *   self-reported field in the payload. useWatchSync reads participant.identity
 *   from the transport layer for controller display; a spoofed payload field
 *   would be discarded.
 *
 * - updatedAt uses WatchUpdatedAt (year-2100 cap) — H2 schema remediation.
 *   Pair with isWatchEventFresh() at call-site for the runtime skew cap.
 *
 * - positionSec uses WatchPositionSec (≤ 86 400 s) — L2 remediation.
 *
 * - providerId is z.literal("youtube") for v1.1. When adding a second
 *   provider, expand to z.enum([...]) in the same PR that adds the registry
 *   entry. Never accept arbitrary strings (security-review open question #4).
 */

/** watch/load — broadcast when a participant loads a new video. RELIABLE. */
const WatchLoadSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  ts: z.number().int().nonnegative(),
  type: z.literal("watch/load"),
  // M3: no controllerId — sender identity comes from LiveKit DataReceived arg.
  providerId: z.literal("youtube"),
  mediaId: WatchMediaId,
  positionSec: WatchPositionSec,
  updatedAt: WatchUpdatedAt,
});

/** watch/play — broadcast when any participant resumes playback. RELIABLE. */
const WatchPlaySchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  ts: z.number().int().nonnegative(),
  type: z.literal("watch/play"),
  // M3: no controllerId — sender identity comes from LiveKit DataReceived arg.
  positionSec: WatchPositionSec,
  updatedAt: WatchUpdatedAt,
});

/** watch/pause — broadcast when any participant pauses playback. RELIABLE. */
const WatchPauseSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  ts: z.number().int().nonnegative(),
  type: z.literal("watch/pause"),
  // M3: no controllerId — sender identity comes from LiveKit DataReceived arg.
  positionSec: WatchPositionSec,
  updatedAt: WatchUpdatedAt,
});

/** watch/seek — broadcast when any participant scrubs to a new position. RELIABLE. */
const WatchSeekSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  ts: z.number().int().nonnegative(),
  type: z.literal("watch/seek"),
  // M3: no controllerId — sender identity comes from LiveKit DataReceived arg.
  positionSec: WatchPositionSec,
  updatedAt: WatchUpdatedAt,
});

/**
 * watch/heartbeat — drift-correction broadcast every 3 s while playing. LOSSY.
 * Receivers compare remote.positionSec + age(remote.updatedAt) to local
 * getPosition(); if |diff| > 1.5 s, seek to the remote position.
 */
const WatchHeartbeatSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  ts: z.number().int().nonnegative(),
  type: z.literal("watch/heartbeat"),
  // M3: no controllerId — sender identity comes from LiveKit DataReceived arg.
  positionSec: WatchPositionSec,
  updatedAt: WatchUpdatedAt,
});

/**
 * watch/stop — broadcast when any participant stops Watch Mode for the room.
 * Receiving peers tear down the player and return to base (voice + video +
 * optional screen-share). RELIABLE — a lost stop leaves a peer stuck on a
 * stale player; explicit type preferred over reusing watch/load with empty
 * mediaId (avoids ambiguity at the receiver).
 */
const WatchStopSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  ts: z.number().int().nonnegative(),
  type: z.literal("watch/stop"),
  // M3: no controllerId — sender identity comes from LiveKit DataReceived arg.
  updatedAt: WatchUpdatedAt,
});

/** Union of every valid inbound event on the data channel. */
export const RoomEventSchema = z.union([
  ReactionSchema,
  HoldSchema,
  WhisperSchema,
  CardSchema,
  HelloSchema,
  ShareRequestSchema,
  LookAtMeSchema,
  ChatSchema,
  BackgroundSchema,
  GameSchema,
  TruthOrDareSchema,
  DrawSchema,
  MoviePickerSchema,
  MovieTriviaSchema,
  EmojiCharadesSchema,
  WouldYouRatherSchema,
  NeverHaveIEverSchema,
  MostLikelyToSchema,
  HowWellSchema,
  StoryTimeSchema,
  TwoTruthsSchema,
  SlowDownSchema,
  WatchLoadSchema,
  WatchPlaySchema,
  WatchPauseSchema,
  WatchSeekSchema,
  WatchHeartbeatSchema,
  WatchStopSchema,
]);

export type RoomEvent = z.infer<typeof RoomEventSchema>;
export type ReactionEvent = z.infer<typeof ReactionSchema>;
export type HoldEvent = z.infer<typeof HoldSchema>;
export type WhisperEvent = z.infer<typeof WhisperSchema>;
export type CardEvent = z.infer<typeof CardSchema>;
export type HelloEvent = z.infer<typeof HelloSchema>;
export type ShareRequestEvent = z.infer<typeof ShareRequestSchema>;
export type LookAtMeEvent = z.infer<typeof LookAtMeSchema>;
export type ChatEvent = z.infer<typeof ChatSchema>;
export type BackgroundEvent = z.infer<typeof BackgroundSchema>;
export type GameEvent = z.infer<typeof GameSchema>;
export type TruthOrDareEvent = z.infer<typeof TruthOrDareSchema>;
export type DrawEvent = z.infer<typeof DrawSchema>;
export type MoviePickerEvent = z.infer<typeof MoviePickerSchema>;
export type MovieTriviaEvent = z.infer<typeof MovieTriviaSchema>;
export type EmojiCharadesEvent = z.infer<typeof EmojiCharadesSchema>;
export type WouldYouRatherEvent = z.infer<typeof WouldYouRatherSchema>;
export type NeverHaveIEverEvent = z.infer<typeof NeverHaveIEverSchema>;
export type MostLikelyToEvent = z.infer<typeof MostLikelyToSchema>;
export type HowWellEvent = z.infer<typeof HowWellSchema>;
export type StoryTimeEvent = z.infer<typeof StoryTimeSchema>;
export type TwoTruthsEvent = z.infer<typeof TwoTruthsSchema>;
export type SlowDownEvent = z.infer<typeof SlowDownSchema>;
export type WatchLoadEvent = z.infer<typeof WatchLoadSchema>;
export type WatchPlayEvent = z.infer<typeof WatchPlaySchema>;
export type WatchPauseEvent = z.infer<typeof WatchPauseSchema>;
export type WatchSeekEvent = z.infer<typeof WatchSeekSchema>;
export type WatchHeartbeatEvent = z.infer<typeof WatchHeartbeatSchema>;
export type WatchStopEvent = z.infer<typeof WatchStopSchema>;

// ---- Encode / decode ------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

/**
 * Encode an event to the UTF-8 byte payload LiveKit's `publishData` takes.
 *
 * TS 5.7 tightened `TextEncoder.encode` to `Uint8Array<ArrayBufferLike>`,
 * but livekit-client's `publishData` still declares `Uint8Array<ArrayBuffer>`.
 * We copy into a fresh ArrayBuffer so the return type is assignable. One
 * small alloc per publish; envelopes are < 1 KB.
 */
export function encodeEvent(event: RoomEvent): Uint8Array<ArrayBuffer> {
  const source = encoder.encode(JSON.stringify(event));
  const out = new Uint8Array(source.byteLength);
  out.set(source);
  return out;
}

/**
 * Decode + validate an inbound payload. Returns `null` for anything we can't
 * or shouldn't act on (malformed JSON, wrong version, unknown type, bad
 * shape). Never throws — callers can `if (event === null) return`.
 *
 * `onDrop` is optional; when supplied, gets a structured reason for logs.
 * Kept as a callback so this module has zero side effects and stays trivially
 * testable.
 */
export function decodeEvent(
  payload: Uint8Array,
  onDrop?: (reason: DropReason) => void,
): RoomEvent | null {
  let text: string;
  try {
    text = decoder.decode(payload);
  } catch {
    onDrop?.({ kind: "decode_error" });
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    onDrop?.({ kind: "invalid_json" });
    return null;
  }

  // Version check runs before schema so we don't spend time on a payload we'd
  // drop anyway, and so peers on a future `v` don't spam our error path.
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as { v?: unknown }).v !== ENVELOPE_VERSION
  ) {
    onDrop?.({ kind: "wrong_version" });
    return null;
  }

  const parsed = RoomEventSchema.safeParse(raw);
  if (!parsed.success) {
    onDrop?.({ kind: "schema_error" });
    return null;
  }
  return parsed.data;
}

export type DropReason =
  | { kind: "decode_error" }
  | { kind: "invalid_json" }
  | { kind: "wrong_version" }
  | { kind: "schema_error" };
