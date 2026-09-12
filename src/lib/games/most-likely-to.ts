/**
 * Most Likely To — couples game where both peers simultaneously point at
 * whoever fits the prompt (me / you). Results reveal together; matches ("we
 * both said her") and mismatches ("we disagree") are half the fun.
 *
 * Prompts skew playful and revealing rather than mean — long-distance
 * couples game night, not a roast. Order is decided by the weekly seeded
 * shuffle in `./shuffle.ts`, so both peers stay in sync without any
 * per-round negotiation and the deck rotates fresh every Monday UTC.
 */

import { pickFromDeck } from "./shuffle";

export interface MLTPrompt {
  id: string;
  text: string;
  flavor?: string;
}

const MLT_DECK_ID = "mlt";

export const MLT_DECK: MLTPrompt[] = [
  { id: "mlt-1", text: "laugh at their own joke", flavor: "😂" },
  { id: "mlt-2", text: "cry during a Pixar movie", flavor: "🎬" },
  { id: "mlt-3", text: "forget where they put their phone", flavor: "📱" },
  { id: "mlt-4", text: "sing in the shower", flavor: "🚿" },
  { id: "mlt-5", text: "burn dinner on date night", flavor: "🔥" },
  { id: "mlt-6", text: "start a spontaneous roadtrip", flavor: "🚗" },
  { id: "mlt-7", text: "adopt a stray animal on the way home", flavor: "🐕" },
  { id: "mlt-8", text: "become internet-famous by accident", flavor: "📸" },
  { id: "mlt-9", text: "text their ex just to say hi", flavor: "🙊" },
  { id: "mlt-10", text: "survive a horror movie", flavor: "🔪" },
  { id: "mlt-11", text: "leave dishes in the sink for a week", flavor: "🍽️" },
  { id: "mlt-12", text: "become a millionaire before 40", flavor: "💰" },
  { id: "mlt-13", text: "cry at a wedding they weren't invited to", flavor: "💍" },
  { id: "mlt-14", text: "get lost in their own neighborhood", flavor: "🧭" },
  { id: "mlt-15", text: "fall asleep first on movie night", flavor: "😴" },
  { id: "mlt-16", text: "start a fight over what to eat", flavor: "🍕" },
  { id: "mlt-17", text: "end up on a reality TV show", flavor: "📺" },
  { id: "mlt-18", text: "run a marathon on a whim", flavor: "🏃" },
  { id: "mlt-19", text: "learn a language and never use it", flavor: "🗣️" },
  { id: "mlt-20", text: "book a flight in the middle of the night", flavor: "✈️" },
  { id: "mlt-21", text: "eat the last slice of pizza without asking", flavor: "🍕" },
  { id: "mlt-22", text: "cry over spilled coffee", flavor: "☕" },
  { id: "mlt-23", text: "start a new hobby every month", flavor: "🎨" },
  { id: "mlt-24", text: "get us matching tattoos", flavor: "💉" },
  { id: "mlt-25", text: "insist on the aux cord", flavor: "🎵" },
  { id: "mlt-26", text: "reply to a text three days later", flavor: "💬" },
  { id: "mlt-27", text: "spoil the ending of a movie", flavor: "🎞️" },
  { id: "mlt-28", text: "adopt six dogs in one weekend", flavor: "🐶" },
  { id: "mlt-29", text: "haggle at a market", flavor: "🛍️" },
  { id: "mlt-30", text: "become a great parent someday", flavor: "👶" },
  { id: "mlt-31", text: "get us kicked out of a restaurant", flavor: "😳" },
  { id: "mlt-32", text: "write a book about our relationship", flavor: "📖" },
  { id: "mlt-33", text: "start dancing in a grocery store", flavor: "💃" },
  { id: "mlt-34", text: "pretend to like a bad gift", flavor: "🎁" },
  { id: "mlt-35", text: "remember every anniversary detail", flavor: "🌹" },
  { id: "mlt-36", text: "sleep through their alarm", flavor: "⏰" },
  { id: "mlt-37", text: "give the perfect gift", flavor: "🎀" },
  { id: "mlt-38", text: "argue with a GPS", flavor: "🗺️" },
  { id: "mlt-39", text: "cry at a puppy commercial", flavor: "🐕" },
  { id: "mlt-40", text: "throw the best surprise party", flavor: "🎉" },
];

export function getMLTPrompt(idx: number, weekSeed: number): MLTPrompt {
  return pickFromDeck(MLT_DECK, idx, weekSeed, MLT_DECK_ID);
}

export const MLT_DECK_LENGTH = MLT_DECK.length;
