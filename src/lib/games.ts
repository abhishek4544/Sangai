/**
 * Couple Games catalog. Each entry is one tile on the games grid.
 *
 * Content lives here (not inside components) so a follow-up ticket can add /
 * reorder games without touching UI code. The `status` field distinguishes
 * playable games from "coming soon" placeholders — the grid renders both, but
 * placeholders don't open a game view.
 */
export type GameStatus = "available" | "coming-soon";

export interface GameDef {
  id: string;
  title: string;
  glyph: string;
  tagline: string;
  status: GameStatus;
}

export const GAMES: GameDef[] = [
  // Top of the grid: research-backed classics that work over video with
  // nothing to install (Truth or Dare, Never Have I Ever, Most Likely To,
  // How Well Do You Know Me). Sourced 2026-09-06 from long-distance couple
  // game round-ups (Lovely, Lovify, SyncWithLove, MyHeroCards).
  {
    id: "would-you-rather",
    title: "Would You Rather",
    glyph: "🤔",
    tagline: "Pick A or B — reveal together.",
    status: "available",
  },
  {
    id: "truth-or-dare",
    title: "Truth or Dare",
    glyph: "🎲",
    tagline: "Pick your poison, one turn at a time.",
    status: "available",
  },
  {
    id: "never-have-i-ever",
    title: "Never Have I Ever",
    glyph: "🚫",
    tagline: "Tap if you've done it. Reveal what surprises.",
    status: "available",
  },
  {
    id: "most-likely-to",
    title: "Most Likely To",
    glyph: "👑",
    tagline: "Point at whoever fits. See if you agree.",
    status: "available",
  },
  {
    id: "how-well",
    title: "How Well Do You Know Me?",
    glyph: "💭",
    tagline: "Answer for yourself and for each other.",
    status: "available",
  },
  {
    id: "two-truths",
    title: "Two Truths & a Lie",
    glyph: "🕵️",
    tagline: "Guess the lie in your partner's three.",
    status: "available",
  },
  {
    id: "trivia",
    title: "Movie Trivia",
    glyph: "🎬",
    tagline: "Test each other on your favorites.",
    status: "available",
  },
  {
    id: "emoji-guess",
    title: "Emoji Charades",
    glyph: "🎭",
    tagline: "Describe a movie in emojis.",
    status: "available",
  },
  {
    id: "draw-together",
    title: "Draw Together",
    glyph: "🎨",
    tagline: "Doodle on a shared canvas.",
    status: "available",
  },
  // Cooperative co-authoring game — the only "build together" game in the
  // grid, so worth a distinct icon and tagline. Same weekly-shuffle pattern
  // as the other pick games.
  {
    id: "story-time",
    title: "Story Time",
    glyph: "📖",
    tagline: "Write a silly love story together, one blank at a time.",
    status: "available",
  },
  // Meditative counterweight to the arcade games — timed cooperative
  // rituals for two. Distinct enough (calm palette, no scoring) that it
  // reads as a different mode when it opens.
  {
    id: "slow-down",
    title: "Slow Down",
    glyph: "🕯️",
    tagline: "Timed rituals for two — presence over points.",
    status: "available",
  },
];

export function getGameById(id: string): GameDef | null {
  return GAMES.find((g) => g.id === id) ?? null;
}
