import { describe, expect, it } from "vitest";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_CODE_REGEX,
  generateRoomCode,
} from "./code";

describe("generateRoomCode", () => {
  it("produces codes of the expected length", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateRoomCode()).toHaveLength(ROOM_CODE_LENGTH);
    }
  });

  it("uses only alphabet characters (no 0/O/1/I/L)", () => {
    for (let i = 0; i < 1000; i++) {
      const code = generateRoomCode();
      for (const ch of code) {
        expect(ROOM_CODE_ALPHABET).toContain(ch);
      }
      // Explicit belt-and-braces: forbidden look-alikes must never appear.
      expect(code).not.toMatch(/[01OIL]/);
    }
  });

  it("matches the exported regex", () => {
    for (let i = 0; i < 100; i++) {
      expect(ROOM_CODE_REGEX.test(generateRoomCode())).toBe(true);
    }
  });

  it("has no obvious character-distribution skew across 10k samples", () => {
    const N = 10_000;
    const counts = new Map<string, number>();
    for (const ch of ROOM_CODE_ALPHABET) counts.set(ch, 0);

    for (let i = 0; i < N; i++) {
      for (const ch of generateRoomCode()) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
    }

    const totalChars = N * ROOM_CODE_LENGTH;
    const expected = totalChars / ROOM_CODE_ALPHABET.length;
    // Uniform distribution → each char should land within ±25% of expected.
    // Very generous bound; a broken RNG (e.g. modulo bias favoring the low
    // 8 chars of a 31-char alphabet by ~3.2%) would still pass this, but a
    // catastrophically bad one (Math.random, constant, off-by-one) would not.
    const min = expected * 0.75;
    const max = expected * 1.25;
    for (const [ch, count] of counts) {
      expect(count, `char ${ch} count ${count} out of [${min}, ${max}]`)
        .toBeGreaterThanOrEqual(min);
      expect(count).toBeLessThanOrEqual(max);
    }
  });

  it("is not deterministic — two batches do not collide meaningfully", () => {
    const a = new Set<string>();
    const b = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      a.add(generateRoomCode());
      b.add(generateRoomCode());
    }
    // 31^6 space → 1000 vs 1000 birthday collisions expected ~= 1000^2 / 2 / 887M ≈ 5.6e-4.
    // Zero overlap the overwhelming majority of the time; we allow up to
    // 5 accidental collisions to keep the test non-flaky.
    let overlap = 0;
    for (const code of a) if (b.has(code)) overlap++;
    expect(overlap).toBeLessThan(5);
  });
});
