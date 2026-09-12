/**
 * Would You Rather — content pack for the couples game.
 *
 * Each prompt is one round. `a` and `b` are the two options; both must read as
 * genuine choices — the point of the game is the argument that follows, so
 * neither side should be an obvious no-go. Keep options short (≤ 60 chars) so
 * the big card typography stays big. Ordering is stable; deck cursor lives
 * in game state and both peers stay synced via `roundIdx` on the wire.
 *
 * Add prompts freely — the deck is content-driven and picks up new entries
 * without any UI change. Peers on stale versions cap at their own deck length
 * and both sides derive the same idx-mod-length so drift is harmless.
 */

export interface WYRPrompt {
  id: string;
  a: string;
  b: string;
  /** Optional emoji flourish for the "OR" divider on this round. */
  flavor?: string;
}

export const WYR_DECK: WYRPrompt[] = [
  { id: "wyr-superpower-1", a: "Read minds", b: "Be invisible", flavor: "🦸" },
  { id: "wyr-superpower-2", a: "Fly anywhere", b: "Teleport anywhere", flavor: "✨" },
  { id: "wyr-money-1", a: "Win $10K every month for life", b: "Get $5M today", flavor: "💰" },
  { id: "wyr-food-1", a: "Never eat pizza again", b: "Never eat chocolate again", flavor: "🍕" },
  { id: "wyr-food-2", a: "Only sweet food forever", b: "Only savory food forever", flavor: "🍰" },
  { id: "wyr-couple-1", a: "Cook together every night", b: "Order in every night", flavor: "🍜" },
  { id: "wyr-couple-2", a: "A romantic beach getaway", b: "A snowy mountain cabin", flavor: "🏖️" },
  { id: "wyr-couple-3", a: "Slow dance in the kitchen", b: "Sing badly in the car", flavor: "💃" },
  { id: "wyr-life-1", a: "Live 200 years in one place", b: "Live 80 years all over the world", flavor: "🌍" },
  { id: "wyr-life-2", a: "Always be 10 minutes early", b: "Always be 10 minutes late", flavor: "⏰" },
  { id: "wyr-tech-1", a: "No phone for a month", b: "No hot water for a month", flavor: "📵" },
  { id: "wyr-tech-2", a: "Time travel to the past", b: "Time travel to the future", flavor: "🕰️" },
  { id: "wyr-movie-1", a: "Live in a horror movie", b: "Live in a romcom", flavor: "🎬" },
  { id: "wyr-movie-2", a: "Star in a Marvel film", b: "Star in a Christopher Nolan film", flavor: "🦸‍♀️" },
  { id: "wyr-movie-3", a: "Rewatch your top 5 forever", b: "Only new movies you've never seen", flavor: "🎞️" },
  { id: "wyr-quirk-1", a: "Always know when someone's lying", b: "Always get away with lying", flavor: "🤥" },
  { id: "wyr-quirk-2", a: "Hiccup for the rest of your life", b: "Sneeze 20 times every morning", flavor: "🤧" },
  { id: "wyr-quirk-3", a: "Speak every language poorly", b: "Speak one extra language perfectly", flavor: "🗣️" },
  { id: "wyr-adventure-1", a: "Backpack Europe for a month", b: "Roadtrip the US for a month", flavor: "🎒" },
  { id: "wyr-adventure-2", a: "Skydive at sunrise", b: "Deep-sea dive at midnight", flavor: "🪂" },
  { id: "wyr-couple-4", a: "Breakfast in bed every day", b: "A back rub every night", flavor: "🛏️" },
  { id: "wyr-couple-5", a: "Endless hugs, no words", b: "Endless words, no hugs", flavor: "🤗" },
  { id: "wyr-couple-6", a: "A house full of dogs", b: "A house full of cats", flavor: "🐕" },
  { id: "wyr-life-3", a: "Never do laundry again", b: "Never do dishes again", flavor: "🧺" },
  { id: "wyr-life-4", a: "Have every meal delivered", b: "Have every trip fully paid", flavor: "🚚" },
  { id: "wyr-weird-1", a: "Fingers as long as legs", b: "Legs as long as fingers", flavor: "🖐️" },
  { id: "wyr-weird-2", a: "Sweat maple syrup", b: "Cry glitter", flavor: "✨" },
  { id: "wyr-quirk-4", a: "Sing every sentence you say", b: "Rhyme every sentence you say", flavor: "🎤" },
  { id: "wyr-adventure-3", a: "Meet your future self", b: "Meet your past self", flavor: "🔮" },
  { id: "wyr-couple-7", a: "One weekend a year, no phones", b: "One night a week, no plans", flavor: "📴" },
  { id: "wyr-food-3", a: "Coffee for the rest of your life", b: "Tea for the rest of your life", flavor: "☕" },
  { id: "wyr-food-4", a: "Sushi every day", b: "Tacos every day", flavor: "🍣" },
  { id: "wyr-life-5", a: "Skip to the good parts", b: "Live every minute in order", flavor: "⏭️" },
  { id: "wyr-quirk-5", a: "Always know what's for dinner", b: "Always be surprised by dinner", flavor: "🍽️" },
  { id: "wyr-tech-3", a: "Only communicate in voice notes", b: "Only communicate in memes", flavor: "🎙️" },
  { id: "wyr-couple-8", a: "Handwritten love letters", b: "Long voice memos", flavor: "💌" },
  { id: "wyr-adventure-4", a: "Ride a hot-air balloon at sunset", b: "Ride a gondola in Venice", flavor: "🎈" },
  { id: "wyr-movie-4", a: "Be the villain everyone loves", b: "Be the hero everyone forgets", flavor: "🦹" },
  { id: "wyr-weird-3", a: "Talk to animals", b: "Talk to plants", flavor: "🐈" },
  { id: "wyr-life-6", a: "Retire at 30, work again at 60", b: "Work until 50, retire forever", flavor: "🌴" },
];

import { pickFromDeck } from "./shuffle";

const WYR_DECK_ID = "wyr";

/**
 * Return the prompt for a given logical round. Order is derived from a
 * seeded shuffle keyed on the ISO-UTC week number, so both peers pick the
 * same prompt without coordinating, and the deck rotates fresh every week.
 * See `./shuffle.ts` for the repeat-avoidance guarantees.
 */
export function getWYRPrompt(idx: number, weekSeed: number): WYRPrompt {
  return pickFromDeck(WYR_DECK, idx, weekSeed, WYR_DECK_ID);
}

export const WYR_DECK_LENGTH = WYR_DECK.length;
