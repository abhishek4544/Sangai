/**
 * Weekly-rotating deterministic shuffle for game decks.
 *
 * Two constraints, one solution:
 *   1. Both peers in a room must see the *same* prompt at the same `roundIdx`
 *      — so we can't call Math.random() per peer.
 *   2. The deck order should feel fresh week-over-week so couples opening
 *      the same game next Sunday don't see the same "round 1".
 *
 * Both are satisfied by a seeded Fisher-Yates permutation of the deck, keyed
 * on the ISO-UTC week number. Same week + same deck → identical permutation
 * on both sides with zero over-the-wire coordination. Next week → new seed
 * → new permutation.
 *
 * Repeat avoidance: within a single pass (0..len-1) every prompt appears
 * exactly once — that's what Fisher-Yates gives you. Once `roundIdx` wraps
 * past the deck length, the cycle counter (floor(idx/len)) bumps and the
 * seed becomes `weekSeed + cycle`, so the next full pass reshuffles with a
 * different seed and you don't see the same question in the same slot again.
 *
 * mulberry32 was chosen over crypto.getRandomValues because it's synchronous,
 * seedable, and has plenty of quality for shuffling < 100 items — this is
 * game jitter, not cryptography.
 */

/** Milliseconds in one week (UTC-aligned). */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Anchor to a Monday UTC so the week rolls over at a predictable moment.
 *  1970-01-01 was a Thursday; adding 3 days lands the epoch on the Monday
 *  UTC boundary we use as the "week 0" origin. */
const MONDAY_ANCHOR_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Integer week counter since a fixed UTC Monday origin. Both peers on the
 * same wall clock compute the same number; a several-hour timezone gap is
 * irrelevant because we round to whole weeks.
 */
export function getWeekSeed(now: number = Date.now()): number {
  return Math.floor((now + MONDAY_ANCHOR_MS) / WEEK_MS);
}

/**
 * mulberry32 — small deterministic PRNG. Returns a function that yields a
 * new [0, 1) float on each call. Only used to drive Fisher-Yates below.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** djb2 string hash — folds the deckId into an int so each game gets its
 *  own weekly rotation even if two decks happened to be identical. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return h >>> 0;
}

/** Deterministic Fisher-Yates. Pure; returns a new array. */
function shuffleWithSeed<T>(deck: readonly T[], seed: number): T[] {
  const out = deck.slice();
  const rand = mulberry32(seed || 1); // 0 seed collapses mulberry32; guard.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Module-level cache of shuffled decks keyed by "<deckIdentityHint>:<seed>".
 * Prevents re-shuffling on every render; the cache is unbounded but grows
 * at ~1 entry per week per deck per session — negligible.
 */
const shuffleCache = new Map<string, unknown[]>();

/**
 * Get the prompt at logical round `idx` from `deck`, using the weekly seed
 * plus a cycle bump so repeats never happen inside a single pass through
 * the deck.
 *
 * `deckId` is a string discriminator so different decks (WYR / NHIE / …)
 * don't collide in the cache and get distinct permutations even with the
 * same week seed.
 */
export function pickFromDeck<T>(
  deck: readonly T[],
  idx: number,
  weekSeed: number,
  deckId: string,
): T {
  const len = deck.length;
  if (len === 0) throw new Error(`pickFromDeck: empty deck ${deckId}`);
  const cycle = Math.floor(idx / len);
  const position = idx % len;
  // Salt with deckId hash so each game has its own weekly rotation and the
  // cycle bump gives a distinct permutation from the same-week previous pass.
  const cycleSeed = (weekSeed + cycle + hashString(deckId)) >>> 0;
  const cacheKey = `${deckId}:${cycleSeed}`;
  let shuffled = shuffleCache.get(cacheKey) as T[] | undefined;
  if (!shuffled) {
    shuffled = shuffleWithSeed(deck, cycleSeed);
    shuffleCache.set(cacheKey, shuffled);
  }
  return shuffled[position];
}
