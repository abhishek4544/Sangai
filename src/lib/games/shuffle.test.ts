import { describe, expect, it } from "vitest";
import { getWeekSeed, pickFromDeck } from "./shuffle";

const DECK = Array.from({ length: 40 }, (_, i) => `item-${i}`);

describe("getWeekSeed", () => {
  it("returns identical seeds for two moments in the same week", () => {
    // Monday 2026-09-07 10:00 UTC and Sunday 2026-09-13 23:00 UTC are the
    // same UTC-week window under a Monday anchor.
    const monday = Date.UTC(2026, 8, 7, 10);
    const sunday = Date.UTC(2026, 8, 13, 23);
    expect(getWeekSeed(monday)).toBe(getWeekSeed(sunday));
  });

  it("increments by 1 across the Monday UTC boundary", () => {
    const before = Date.UTC(2026, 8, 13, 23, 59);
    const after = Date.UTC(2026, 8, 14, 0, 1);
    expect(getWeekSeed(after) - getWeekSeed(before)).toBe(1);
  });
});

describe("pickFromDeck", () => {
  it("both peers computing independently get the same prompt for the same seed", () => {
    // Peer A and Peer B call pickFromDeck separately with the same args.
    for (let idx = 0; idx < 100; idx++) {
      const a = pickFromDeck(DECK, idx, 42, "test");
      const b = pickFromDeck(DECK, idx, 42, "test");
      expect(a).toBe(b);
    }
  });

  it("visits every deck entry exactly once per full pass", () => {
    const seen = new Set<string>();
    for (let idx = 0; idx < DECK.length; idx++) {
      seen.add(pickFromDeck(DECK, idx, 42, "test-pass"));
    }
    expect(seen.size).toBe(DECK.length);
  });

  it("uses a different permutation on the second pass (cycle bump)", () => {
    const firstPass = Array.from({ length: DECK.length }, (_, i) =>
      pickFromDeck(DECK, i, 42, "test-cycle"),
    );
    const secondPass = Array.from({ length: DECK.length }, (_, i) =>
      pickFromDeck(DECK, DECK.length + i, 42, "test-cycle"),
    );
    // Second pass still visits every entry once…
    expect(new Set(secondPass).size).toBe(DECK.length);
    // …but not in the same order as the first.
    const same = firstPass.every((v, i) => v === secondPass[i]);
    expect(same).toBe(false);
  });

  it("uses a different permutation on a different week seed", () => {
    const weekA = Array.from({ length: DECK.length }, (_, i) =>
      pickFromDeck(DECK, i, 100, "test-week"),
    );
    const weekB = Array.from({ length: DECK.length }, (_, i) =>
      pickFromDeck(DECK, i, 101, "test-week"),
    );
    const same = weekA.every((v, i) => v === weekB[i]);
    expect(same).toBe(false);
  });

  it("gives distinct permutations for distinct deckIds at the same seed", () => {
    const asWYR = pickFromDeck(DECK, 0, 42, "wyr");
    const asNHIE = pickFromDeck(DECK, 0, 42, "nhie");
    // Not a strict guarantee for every seed, but for seed=42 and a 40-item
    // deck, mulberry32 lands on a different index — this asserts the deckId
    // is actually salting the seed (would fail if we forgot the deckId).
    expect(asWYR).not.toBe(asNHIE);
  });
});
