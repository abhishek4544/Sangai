/**
 * Slow Down — cozy shared-timer couples game.
 *
 * Each round loads a "ritual" prompt (a short cooperative activity like
 * gratitude round, eye contact, memory swap) with a fixed duration. Either
 * partner taps Start → a wire event carries the UTC start timestamp; both
 * peers count down together from that anchor.
 *
 * Deck order is decided by the weekly shuffle (`./shuffle.ts`) so both
 * peers see the same ritual at the same `roundIdx` and the deck rotates
 * fresh every Monday UTC. No repeats within a full pass.
 */

import { pickFromDeck } from "./shuffle";

export interface Ritual {
  id: string;
  title: string;
  /** One-sentence prompt shown on the card before the timer starts. */
  prompt: string;
  /** Soft caption shown during the countdown ("You're doing it — keep going"). */
  duringCaption: string;
  /** Duration in seconds. Kept between 30 s and 120 s so no ritual feels
   *  like a wait. Different rituals need different amounts of quiet. */
  durationSec: number;
  /** Emoji flourish for the card watermark. */
  glyph: string;
}

const SLOW_DECK_ID = "slow-down";

export const SLOW_DECK: Ritual[] = [
  {
    id: "sd-eye-contact",
    title: "Eye Contact",
    prompt: "Just look. No words, no phones. See each other for a full minute.",
    duringCaption: "Stay with each other. It's okay if you smile.",
    durationSec: 60,
    glyph: "👁️",
  },
  {
    id: "sd-gratitude",
    title: "Gratitude Round",
    prompt: "Take turns naming three specific things you appreciate about each other right now.",
    duringCaption: "Speak slowly. Let them land.",
    durationSec: 90,
    glyph: "💛",
  },
  {
    id: "sd-silence",
    title: "Silent Together",
    prompt: "Sit in silence with each other. No talking, no doing. Just present, on the same call.",
    duringCaption: "Nothing to fix. Nothing to say.",
    durationSec: 60,
    glyph: "🌙",
  },
  {
    id: "sd-memory",
    title: "Memory Rewind",
    prompt: "Each of you: share a favorite memory of the other from the past month.",
    duringCaption: "Take your time. Details make it real.",
    durationSec: 90,
    glyph: "📼",
  },
  {
    id: "sd-breathe",
    title: "Breathe Together",
    prompt: "Match your breathing to each other. In for 4, hold for 4, out for 4.",
    duringCaption: "Watch each other's chest rise and fall.",
    durationSec: 60,
    glyph: "🌬️",
  },
  {
    id: "sd-dream",
    title: "Dream Drift",
    prompt: "Each of you: share one small dream out loud. Something soft — not a five-year plan.",
    duringCaption: "No fixing, no planning. Just listen.",
    durationSec: 90,
    glyph: "☁️",
  },
  {
    id: "sd-song",
    title: "Song Swap",
    prompt: "Each of you: play 30 seconds of a song that makes you think of the other.",
    duringCaption: "Feel the song. Watch their face.",
    durationSec: 90,
    glyph: "🎵",
  },
  {
    id: "sd-compliment",
    title: "Compliment Volley",
    prompt: "Take turns giving one true compliment each — bounce back and forth until the timer ends.",
    duringCaption: "Keep it warm. Keep it specific.",
    durationSec: 60,
    glyph: "💐",
  },
  {
    id: "sd-question",
    title: "The Deep One",
    prompt: "One of you asks: 'What has felt like too much lately?' The other listens. Then swap.",
    duringCaption: "No solutions — just witness.",
    durationSec: 120,
    glyph: "🕯️",
  },
  {
    id: "sd-laugh",
    title: "Try Not to Laugh",
    prompt: "Try to keep a straight face while the other tries to make you laugh. Swap halfway.",
    duringCaption: "You're gonna lose. It's fine.",
    durationSec: 60,
    glyph: "😂",
  },
];

export function getRitual(idx: number, weekSeed: number): Ritual {
  return pickFromDeck(SLOW_DECK, idx, weekSeed, SLOW_DECK_ID);
}

export const SLOW_DECK_LENGTH = SLOW_DECK.length;
