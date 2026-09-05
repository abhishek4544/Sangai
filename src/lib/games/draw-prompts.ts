/**
 * Draw Together — shared prompts. Kept as ids so the wire carries a token,
 * not the whole string; matches the pattern used by date-cards / t-o-d.
 *
 * Prompts are playful and low-stakes — no one is a good drawer under
 * pressure, and the point is to laugh at the result together.
 */
export interface DrawPrompt {
  id: string;
  text: string;
}

export const DRAW_PROMPTS: DrawPrompt[] = [
  { id: "dp01", text: "Draw us as pizza toppings" },
  { id: "dp02", text: "Draw last night's dinner" },
  { id: "dp03", text: "Draw the last movie we watched" },
  { id: "dp04", text: "Draw your partner as a fruit" },
  { id: "dp05", text: "Draw a house we'd live in one day" },
  { id: "dp06", text: "Draw the worst pet you can imagine" },
  { id: "dp07", text: "Draw a superhero of your partner" },
  { id: "dp08", text: "Draw your idea of a perfect Sunday" },
  { id: "dp09", text: "Draw a landscape that feels like us" },
  { id: "dp10", text: "Draw us as cartoon characters" },
  { id: "dp11", text: "Draw your dream vacation in one image" },
  { id: "dp12", text: "Draw your favorite meal from memory" },
  { id: "dp13", text: "Draw the weirdest fashion outfit possible" },
  { id: "dp14", text: "Draw your partner's dance move" },
  { id: "dp15", text: "Draw a monster made of things you love" },
  { id: "dp16", text: "Draw your emotional state right now" },
  { id: "dp17", text: "Draw a mythical creature we'd adopt" },
  { id: "dp18", text: "Draw the future — pick a year" },
  { id: "dp19", text: "Draw what silence looks like" },
  { id: "dp20", text: "Draw a memory in five shapes" },
  { id: "dp21", text: "Draw the last text you sent as a picture" },
  { id: "dp22", text: "Draw a room you've never seen but want to" },
  { id: "dp23", text: "Draw your partner's spirit vegetable" },
  { id: "dp24", text: "Draw yourselves 50 years from now" },
];

export function getDrawPrompt(id: string): DrawPrompt | null {
  return DRAW_PROMPTS.find((p) => p.id === id) ?? null;
}

export function pickRandomDrawPromptId(exclude: string | null): string {
  const pool = exclude
    ? DRAW_PROMPTS.filter((p) => p.id !== exclude)
    : DRAW_PROMPTS;
  return pool[Math.floor(Math.random() * pool.length)]!.id;
}
