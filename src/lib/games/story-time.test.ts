import { describe, expect, it } from "vitest";
import { STORY_DECK, renderStory } from "./story-time";

describe("renderStory", () => {
  it("splits the template into text + blank segments in order", () => {
    const card = STORY_DECK[0];
    const segs = renderStory(card, [0, 0, 0, 0]);
    // Must alternate text / blank starting with text (all templates begin
    // with narration, not a blank).
    expect(segs[0].kind).toBe("text");
    // Blank count matches template placeholders.
    const blanks = segs.filter((s) => s.kind === "blank");
    expect(blanks).toHaveLength(4);
    // Blank indices come out sequential — the renderer preserves order.
    expect(blanks.map((b) => (b as { blankIdx: number }).blankIdx)).toEqual([0, 1, 2, 3]);
  });

  it("uses the chosen option text for filled blanks and ___ for empty", () => {
    const card = STORY_DECK[0];
    const segs = renderStory(card, [2, null, null, null]);
    const filled = segs.find((s) => s.kind === "blank" && s.blankIdx === 0);
    const empty = segs.find((s) => s.kind === "blank" && s.blankIdx === 1);
    expect(filled).toEqual({
      kind: "blank",
      blankIdx: 0,
      value: card.blanks[0].options[2],
    });
    expect(empty).toEqual({ kind: "blank", blankIdx: 1, value: "___" });
  });

  it("stitches back into the exact original template when joined with placeholders", () => {
    const card = STORY_DECK[1];
    const segs = renderStory(card, [null, null, null, null]);
    const roundTripped = segs
      .map((s) =>
        s.kind === "text" ? s.value : `{${(s as { blankIdx: number }).blankIdx}}`,
      )
      .join("");
    expect(roundTripped).toBe(card.template);
  });
});
