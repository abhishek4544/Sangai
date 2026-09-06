/**
 * Emoji Charades movie deck. Curated, ordered — both peers walk the deck by
 * `movieIdx` so no per-round payload is needed on the wire.
 *
 * Titles are famous, family-friendly, and lend themselves to emoji clues. The
 * `hints` array (optional) is a nudge the clue-giver can borrow from if they're
 * stuck; guessers never see it.
 *
 * Fuzzy matching (see `normalizeGuess`) is intentionally forgiving so "the
 * lion king", "Lion King!", "lion-king" all count. Numerals ↔ words is not
 * handled — "2 fast 2 furious" vs "two fast two furious" is a miss on purpose,
 * keeps the parser tiny.
 */

export interface EmojiMovie {
  id: string;
  title: string;
  /** Optional emoji hint the clue-giver can start from. */
  suggested?: string;
  /**
   * Accepted alternates ("aliases"). E.g. "et" for "E.T. the Extra-Terrestrial".
   * Compared post-normalize.
   */
  aliases?: readonly string[];
}

export const EMOJI_MOVIES: EmojiMovie[] = [
  { id: "e01", title: "The Lion King", suggested: "🦁👑" },
  { id: "e02", title: "Titanic", suggested: "🚢🧊💔" },
  { id: "e03", title: "Jaws", suggested: "🦈🏖️🩸" },
  { id: "e04", title: "Star Wars", suggested: "⭐⚔️🚀" },
  { id: "e05", title: "Snakes on a Plane", suggested: "🐍✈️" },
  { id: "e06", title: "Finding Nemo", suggested: "🐠🔍🌊" },
  { id: "e07", title: "Frozen", suggested: "❄️👸🎶" },
  { id: "e08", title: "Up", suggested: "🎈🏠👴" },
  { id: "e09", title: "Inception", suggested: "🌀💤🎯" },
  { id: "e10", title: "The Godfather", suggested: "👨‍💼🐴🎻", aliases: ["godfather"] },
  { id: "e11", title: "Rocky", suggested: "🥊🇺🇸🏆" },
  { id: "e12", title: "E.T. the Extra-Terrestrial", suggested: "👽🚲🌕", aliases: ["et", "e.t.", "extra terrestrial"] },
  { id: "e13", title: "Jurassic Park", suggested: "🦖🌴🚙" },
  { id: "e14", title: "The Matrix", suggested: "💊🕶️💻", aliases: ["matrix"] },
  { id: "e15", title: "Home Alone", suggested: "🏠👦🎄🚨" },
  { id: "e16", title: "Toy Story", suggested: "🤠🚀🧸" },
  { id: "e17", title: "Shrek", suggested: "👹🧅🏰" },
  { id: "e18", title: "Cars", suggested: "🚗🏁💨" },
  { id: "e19", title: "Pulp Fiction", suggested: "💼🕺💃" },
  { id: "e20", title: "La La Land", suggested: "🎹👠🌆🎶" },
  { id: "e21", title: "Ratatouille", suggested: "🐀👨‍🍳🇫🇷" },
  { id: "e22", title: "The Avengers", suggested: "🦸‍♂️🦸‍♀️🌍", aliases: ["avengers"] },
  { id: "e23", title: "Iron Man", suggested: "🤖❤️💥" },
  { id: "e24", title: "Spider-Man", suggested: "🕷️🕸️🗽", aliases: ["spiderman", "spider man"] },
  { id: "e25", title: "Cast Away", suggested: "🏝️🥥🏐", aliases: ["castaway"] },
  { id: "e26", title: "101 Dalmatians", suggested: "🐶🐶🖤🤍", aliases: ["one hundred and one dalmatians", "hundred and one dalmatians"] },
  { id: "e27", title: "The Little Mermaid", suggested: "🧜‍♀️🐚🌊", aliases: ["little mermaid"] },
  { id: "e28", title: "Aladdin", suggested: "🧞‍♂️🪔🐒" },
  { id: "e29", title: "Beauty and the Beast", suggested: "👸🌹🦁" },
  { id: "e30", title: "The Wizard of Oz", suggested: "🌪️👠🦁", aliases: ["wizard of oz"] },
  { id: "e31", title: "Harry Potter", suggested: "🧙‍♂️⚡🦉" },
  { id: "e32", title: "Forrest Gump", suggested: "🏃‍♂️🍫🇺🇸" },
  { id: "e33", title: "The Silence of the Lambs", suggested: "🐑🤫🍷", aliases: ["silence of the lambs"] },
  { id: "e34", title: "Back to the Future", suggested: "🚗⚡🕰️" },
  { id: "e35", title: "The Wolf of Wall Street", suggested: "🐺📈💰", aliases: ["wolf of wall street"] },
  { id: "e36", title: "Kung Fu Panda", suggested: "🐼🥋🐉" },
  { id: "e37", title: "The Pursuit of Happyness", suggested: "👨‍👦💼🌆", aliases: ["pursuit of happyness", "pursuit of happiness"] },
  { id: "e38", title: "Notting Hill", suggested: "📚🇬🇧💐" },
  { id: "e39", title: "The Devil Wears Prada", suggested: "👠📖💼", aliases: ["devil wears prada"] },
  { id: "e40", title: "Slumdog Millionaire", suggested: "🇮🇳💰❓" },
];

export function getEmojiMovie(idx: number): EmojiMovie | null {
  return EMOJI_MOVIES[idx] ?? null;
}

/**
 * Lower-case, strip everything that isn't a letter or digit, collapse to a
 * single string. Intentionally simple — see file header for what's *not*
 * handled.
 */
export function normalizeGuess(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * True iff `guess` matches the movie's title or any alias, post-normalize.
 * Extracted so the component and (eventual) unit tests share the exact same
 * predicate — a mismatch here would strand a correct guess as "wrong".
 */
export function isCorrectGuess(guess: string, movie: EmojiMovie): boolean {
  const g = normalizeGuess(guess);
  if (g.length === 0) return false;
  if (g === normalizeGuess(movie.title)) return true;
  return (movie.aliases ?? []).some((a) => normalizeGuess(a) === g);
}
