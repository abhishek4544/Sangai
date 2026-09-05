/**
 * Mini Date Cards — TICKET-2 (Week 1). Static conversation-prompt deck.
 *
 * Each card has a stable `id` (the envelope's `card.propose` payload references
 * it and both peers look it up locally, so we never ship a full prompt over
 * the wire — smaller packets and forward-compat: adding cards doesn't require
 * a coordinated release). Categories are informational; filter UI is deferred
 * to a follow-up ticket.
 *
 * Vibe tuning: skewed to WARM / CURIOUS over spicy. Two peers watching a
 * movie want a prompt that opens a memory, not one that halts the movie.
 */
export type CardCategory = "light" | "deep" | "silly" | "spicy";

export interface DateCard {
  id: string;
  category: CardCategory;
  prompt: string;
}

export const DATE_CARDS: DateCard[] = [
  // ---- Light — easy openers ---------------------------------------------
  { id: "l01", category: "light", prompt: "What's the best meal we've had together?" },
  { id: "l02", category: "light", prompt: "If we could teleport anywhere for the weekend, where and why?" },
  { id: "l03", category: "light", prompt: "What song reminds you of us?" },
  { id: "l04", category: "light", prompt: "What's a small thing I do that makes you smile?" },
  { id: "l05", category: "light", prompt: "What's the last movie that made you cry?" },
  { id: "l06", category: "light", prompt: "What's your comfort show, and why?" },
  { id: "l07", category: "light", prompt: "If we had a whole day off tomorrow — no phones, no plans — what would we do?" },
  { id: "l08", category: "light", prompt: "What smell instantly puts you in a good mood?" },
  { id: "l09", category: "light", prompt: "What's a place you've been to that you can't wait to take me to?" },
  { id: "l10", category: "light", prompt: "What's your favorite thing to eat when we're apart?" },
  { id: "l11", category: "light", prompt: "What's the best gift you've ever received?" },
  { id: "l12", category: "light", prompt: "If we adopted a pet tomorrow, what and what would we name it?" },

  // ---- Deep — memory / feelings ------------------------------------------
  { id: "d01", category: "deep", prompt: "What's a moment from this year you keep coming back to?" },
  { id: "d02", category: "deep", prompt: "When did you know you cared about me?" },
  { id: "d03", category: "deep", prompt: "What's something you're proud of but rarely tell people?" },
  { id: "d04", category: "deep", prompt: "What's a fear that's smaller now than a year ago?" },
  { id: "d05", category: "deep", prompt: "What does 'home' feel like to you right now?" },
  { id: "d06", category: "deep", prompt: "What's a lesson from your parents you're keeping — and one you're leaving behind?" },
  { id: "d07", category: "deep", prompt: "What's a version of yourself you're becoming?" },
  { id: "d08", category: "deep", prompt: "When do you feel most yourself around me?" },
  { id: "d09", category: "deep", prompt: "What's something you wish more people knew about you?" },
  { id: "d10", category: "deep", prompt: "What did you need as a kid that you're learning to give yourself now?" },
  { id: "d11", category: "deep", prompt: "What's a compliment I gave you that you still think about?" },
  { id: "d12", category: "deep", prompt: "Where do you hope we are in five years?" },

  // ---- Silly — laughter fuel --------------------------------------------
  { id: "s01", category: "silly", prompt: "If we were both cartoon characters, who would we be?" },
  { id: "s02", category: "silly", prompt: "What's the worst haircut you ever had?" },
  { id: "s03", category: "silly", prompt: "If our love story were a movie, what genre?" },
  { id: "s04", category: "silly", prompt: "What's a food you pretend to like but secretly don't?" },
  { id: "s05", category: "silly", prompt: "If you could only eat one snack for the rest of your life?" },
  { id: "s06", category: "silly", prompt: "What's the weirdest thing you believed as a kid?" },
  { id: "s07", category: "silly", prompt: "What emoji do you overuse?" },
  { id: "s08", category: "silly", prompt: "What's a superpower that would ruin your life?" },
  { id: "s09", category: "silly", prompt: "Describe our relationship as three menu items." },
  { id: "s10", category: "silly", prompt: "If we opened a food truck, what would it serve?" },
  { id: "s11", category: "silly", prompt: "What's a hill you'd (jokingly) die on?" },
  { id: "s12", category: "silly", prompt: "Who's the messiest of the two of us — and admit it." },

  // ---- Spicy — soft / romantic edge -------------------------------------
  { id: "p01", category: "spicy", prompt: "What's your favorite way I show you I love you?" },
  { id: "p02", category: "spicy", prompt: "What's something small I could do this week that would mean a lot?" },
  { id: "p03", category: "spicy", prompt: "What's a memory of us that you replay?" },
  { id: "p04", category: "spicy", prompt: "What's a way I make you feel wanted?" },
  { id: "p05", category: "spicy", prompt: "What's your ideal 'us' morning?" },
  { id: "p06", category: "spicy", prompt: "What's the best kiss we've had — and why?" },
  { id: "p07", category: "spicy", prompt: "What's a habit of yours that I've slowly picked up?" },
  { id: "p08", category: "spicy", prompt: "What's something you want us to try — big or small?" },
  { id: "p09", category: "spicy", prompt: "What do you feel when you first see me after we've been apart?" },
];

export function getCardById(id: string): DateCard | null {
  return DATE_CARDS.find((c) => c.id === id) ?? null;
}

/**
 * Pick a random card id that isn't the currently-visible one.
 * Deterministic-free — RNG is fine here; the same id echoing back would just
 * feel repetitive, not incorrect.
 */
export function pickRandomCardId(exclude: string | null): string {
  const pool = exclude
    ? DATE_CARDS.filter((c) => c.id !== exclude)
    : DATE_CARDS;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx]!.id;
}
