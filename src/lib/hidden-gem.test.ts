import { describe, expect, it } from "vitest";
import type { Movie } from "./tmdb";
import {
  GEM_THRESHOLD,
  M_VOTE_FLOOR,
  computeStats,
  isHiddenGem,
  weightedRating,
} from "./hidden-gem";

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

/**
 * Build a `Movie` fixture. Terse — only the numeric fields the formula reads
 * actually vary per test; identity/media fields get sensible defaults.
 */
function movie(
  overrides: Partial<Movie> & {
    id?: number;
    vote_average?: number;
    vote_count?: number;
    popularity?: number;
    title?: string;
  } = {},
): Movie {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? "Test Movie",
    poster_path: overrides.poster_path ?? "/poster.jpg",
    vote_average: overrides.vote_average ?? 7.0,
    vote_count: overrides.vote_count ?? 500,
    popularity: overrides.popularity ?? 10,
    release_date: overrides.release_date ?? "2020-01-01",
  };
}

// ---------------------------------------------------------------------------
// weightedRating
// ---------------------------------------------------------------------------

describe("weightedRating", () => {
  it("returns C when v is 0 (all weight on the prior)", () => {
    expect(weightedRating({ R: 9.5, v: 0, m: 300, C: 6.0 })).toBe(6.0);
  });

  it("returns R when m is 0 and v > 0 (all weight on the observed)", () => {
    expect(weightedRating({ R: 8.5, v: 100, m: 0, C: 6.0 })).toBe(8.5);
  });

  it("returns C when both v and m are 0 (divide-by-zero guard, not NaN)", () => {
    const wr = weightedRating({ R: 8.0, v: 0, m: 0, C: 5.5 });

    expect(wr).toBe(5.5);
    expect(Number.isNaN(wr)).toBe(false);
  });

  it("matches the hand-computed WR for a known input", () => {
    // R=8.0, v=100, m=300, C=6.0
    // WR = (100/400)*8 + (300/400)*6 = 2.0 + 4.5 = 6.5
    const wr = weightedRating({ R: 8.0, v: 100, m: 300, C: 6.0 });

    expect(wr).toBeCloseTo(6.5, 5);
  });

  it("moves WR toward R as v grows when R > C (monotonicity)", () => {
    const low = weightedRating({ R: 9.0, v: 50, m: 300, C: 6.0 });
    const high = weightedRating({ R: 9.0, v: 500, m: 300, C: 6.0 });

    expect(low).toBeLessThan(high);
    // and both are still bounded by R
    expect(high).toBeLessThan(9.0);
  });
});

// ---------------------------------------------------------------------------
// computeStats
// ---------------------------------------------------------------------------

describe("computeStats", () => {
  it("returns zeros on an empty sample (no NaN, no throw)", () => {
    const stats = computeStats([]);

    expect(stats).toEqual({
      C: 0,
      genreMedianPopularity: 0,
      sampleSize: 0,
    });
  });

  it("returns the single movie's own values on a one-movie sample", () => {
    const m = movie({ vote_average: 7.4, popularity: 42.5 });

    const stats = computeStats([m]);

    expect(stats.C).toBe(7.4);
    expect(stats.genreMedianPopularity).toBe(42.5);
    expect(stats.sampleSize).toBe(1);
  });

  it("computes median with odd count (5 items → middle element)", () => {
    const sample = [10, 20, 30, 40, 50].map((p, i) =>
      movie({ id: i, popularity: p }),
    );

    const stats = computeStats(sample);

    expect(stats.genreMedianPopularity).toBe(30);
    expect(stats.sampleSize).toBe(5);
  });

  it("computes median with even count (4 items → mean of the two middles)", () => {
    const sample = [10, 20, 30, 40].map((p, i) =>
      movie({ id: i, popularity: p }),
    );

    const stats = computeStats(sample);

    expect(stats.genreMedianPopularity).toBe(25);
    expect(stats.sampleSize).toBe(4);
  });

  it("is deterministic — two runs on the same input match", () => {
    const sample = [
      movie({ id: 1, vote_average: 7.5, popularity: 30 }),
      movie({ id: 2, vote_average: 6.0, popularity: 10 }),
      movie({ id: 3, vote_average: 8.5, popularity: 50 }),
    ];

    const first = computeStats(sample);
    const second = computeStats(sample);

    expect(first).toEqual(second);
  });

  it("does not mutate its input (safe to pass a frozen array)", () => {
    const sample = Object.freeze([
      movie({ id: 1, popularity: 90 }),
      movie({ id: 2, popularity: 10 }),
      movie({ id: 3, popularity: 50 }),
    ]);
    const snapshotIds = sample.map((m) => m.id);

    expect(() => computeStats(sample)).not.toThrow();
    expect(sample.map((m) => m.id)).toEqual(snapshotIds);
  });
});

// ---------------------------------------------------------------------------
// isHiddenGem — three-gate boundary tests
// ---------------------------------------------------------------------------

describe("isHiddenGem", () => {
  // A stats fixture where the WR arithmetic is easy to reason about:
  //   C = 6.0 (the prior)
  //   genreMedianPopularity = 20
  const baseStats = { C: 6.0, genreMedianPopularity: 20 };

  // WR at 7.2 with C=6.0 and m=300 requires R such that:
  //   7.2 = (v/(v+300))*R + (300/(v+300))*6.0
  // Solve at v=300, m=300:
  //   7.2 = 0.5R + 3.0 → R = 8.4
  const bandOpts = { voteCountMin: 100, voteCountMax: 1000 };

  describe("gate 1 — WR threshold (>=)", () => {
    it("includes a movie whose WR equals GEM_THRESHOLD exactly", () => {
      const m = movie({
        vote_average: 8.4,
        vote_count: 300,
        popularity: 10, // below median
      });
      // Sanity: WR = 7.2 exactly.
      expect(
        weightedRating({ R: 8.4, v: 300, m: 300, C: 6.0 }),
      ).toBeCloseTo(7.2, 10);

      expect(isHiddenGem(m, baseStats, bandOpts)).toBe(true);
    });

    it("excludes a movie whose WR falls just below the threshold", () => {
      // R=8.3 at v=300, m=300, C=6.0 → WR = 0.5*8.3 + 3.0 = 7.15 < 7.2.
      const m = movie({
        vote_average: 8.3,
        vote_count: 300,
        popularity: 10,
      });
      expect(
        weightedRating({ R: 8.3, v: 300, m: 300, C: 6.0 }),
      ).toBeLessThan(GEM_THRESHOLD);

      expect(isHiddenGem(m, baseStats, bandOpts)).toBe(false);
    });
  });

  describe("gate 2 — vote_count band ([min, max], inclusive)", () => {
    // Isolate gate 2 by setting `m: 0` — WR collapses to R, so a high R
    // trivially clears gate 1 regardless of vote_count. Popularity is well
    // below the median.
    const passesRatingAndPop = { vote_average: 9.5, popularity: 5 };
    const isolatedBand = { ...bandOpts, m: 0 };

    it("includes vote_count at the min edge", () => {
      const m = movie({ ...passesRatingAndPop, vote_count: 100 });

      expect(isHiddenGem(m, baseStats, isolatedBand)).toBe(true);
    });

    it("includes vote_count at the max edge", () => {
      const m = movie({ ...passesRatingAndPop, vote_count: 1000 });

      expect(isHiddenGem(m, baseStats, isolatedBand)).toBe(true);
    });

    it("excludes vote_count = min - 1", () => {
      const m = movie({ ...passesRatingAndPop, vote_count: 99 });

      expect(isHiddenGem(m, baseStats, isolatedBand)).toBe(false);
    });

    it("excludes vote_count = max + 1", () => {
      const m = movie({ ...passesRatingAndPop, vote_count: 1001 });

      expect(isHiddenGem(m, baseStats, isolatedBand)).toBe(false);
    });
  });

  describe("gate 3 — popularity < genreMedianPopularity (strict)", () => {
    // A movie that clears gates 1 and 2; popularity is the free variable.
    const clearsOtherGates = { vote_average: 9.5, vote_count: 500 };

    it("includes when popularity is below the genre median", () => {
      const m = movie({ ...clearsOtherGates, popularity: 19.9 });

      expect(isHiddenGem(m, baseStats, bandOpts)).toBe(true);
    });

    it("excludes when popularity equals the genre median (strict <)", () => {
      const m = movie({ ...clearsOtherGates, popularity: 20 });

      expect(isHiddenGem(m, baseStats, bandOpts)).toBe(false);
    });

    it("excludes when popularity is above the genre median", () => {
      const m = movie({ ...clearsOtherGates, popularity: 20.1 });

      expect(isHiddenGem(m, baseStats, bandOpts)).toBe(false);
    });
  });

  describe("combined gates", () => {
    it("a movie passing all three gates is included", () => {
      const m = movie({
        vote_average: 9.5,
        vote_count: 500,
        popularity: 5,
      });

      expect(isHiddenGem(m, baseStats, bandOpts)).toBe(true);
    });

    it("a movie failing exactly one gate (popularity) is excluded", () => {
      const m = movie({
        vote_average: 9.5,
        vote_count: 500,
        popularity: 100, // fails gate 3
      });

      expect(isHiddenGem(m, baseStats, bandOpts)).toBe(false);
    });
  });

  describe("opts defaults", () => {
    it("uses GEM_THRESHOLD when opts.gemThreshold is omitted", () => {
      // WR just below the default 7.2 → excluded when default is used.
      const m = movie({
        vote_average: 8.3, // WR = 7.15 at v=300, m=300, C=6
        vote_count: 300,
        popularity: 5,
      });

      expect(isHiddenGem(m, baseStats, bandOpts)).toBe(false);
    });

    it("respects an explicit lower gemThreshold override", () => {
      // Same movie as above; overriding threshold to 7.0 lets it pass.
      const m = movie({
        vote_average: 8.3,
        vote_count: 300,
        popularity: 5,
      });

      expect(
        isHiddenGem(m, baseStats, { ...bandOpts, gemThreshold: 7.0 }),
      ).toBe(true);
    });

    it("uses M_VOTE_FLOOR when opts.m is omitted (spot-check)", () => {
      // Sanity — the default `m` really is what the module exports.
      // Construct a movie where WR is at the boundary using the default m.
      const m = movie({
        vote_average: 8.4,
        vote_count: 300,
        popularity: 5,
      });
      // With default m = 300: WR = 7.2 → passes.
      expect(isHiddenGem(m, baseStats, bandOpts)).toBe(true);

      // Constant sanity — if this ever drifts, tests above need re-derivation.
      expect(M_VOTE_FLOOR).toBe(300);
      expect(GEM_THRESHOLD).toBe(7.2);
    });

    it("respects an explicit larger m override (pulls WR back toward C)", () => {
      // With the same movie but a much larger `m`, WR drops toward C=6.0
      // and the movie fails gate 1.
      const m = movie({
        vote_average: 8.4,
        vote_count: 300,
        popularity: 5,
      });

      expect(
        isHiddenGem(m, baseStats, { ...bandOpts, m: 5000 }),
      ).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Realistic-scenario test — ~10 movies, "Underground" band
// ---------------------------------------------------------------------------

describe("isHiddenGem — realistic sample (Underground band 200..2000)", () => {
  it("keeps the obvious gem and drops the blockbuster", () => {
    // Sample loosely mirroring what TMDB /discover?sort=popularity.desc returns:
    // a couple of massive blockbusters, mid-list films, and a low-profile-but-
    // well-rated title. Numbers are illustrative, not real.
    const sample: Movie[] = [
      // Blockbusters — huge vote_count and popularity, decent rating.
      movie({ id: 1, vote_average: 7.6, vote_count: 25000, popularity: 500 }),
      movie({ id: 2, vote_average: 7.2, vote_count: 18000, popularity: 400 }),
      movie({ id: 3, vote_average: 6.9, vote_count: 12000, popularity: 300 }),

      // Mid-list.
      movie({ id: 4, vote_average: 6.5, vote_count: 3500, popularity: 120 }),
      movie({ id: 5, vote_average: 6.8, vote_count: 2200, popularity: 90 }),
      movie({ id: 6, vote_average: 7.0, vote_count: 1800, popularity: 60 }),

      // Obvious gem: strong rating, mid vote_count in the Underground band,
      // low popularity (well below the sample median).
      movie({ id: 7, vote_average: 8.6, vote_count: 900, popularity: 8 }),

      // Long-tail low-vote titles (outside the Underground min).
      movie({ id: 8, vote_average: 8.0, vote_count: 150, popularity: 5 }),
      movie({ id: 9, vote_average: 7.5, vote_count: 80, popularity: 3 }),
      movie({ id: 10, vote_average: 6.0, vote_count: 40, popularity: 2 }),
    ];

    const stats = computeStats(sample);
    // Sanity — median of 10 popularities should be finite and sit in the
    // low-mid range given the distribution above.
    expect(stats.sampleSize).toBe(10);
    expect(Number.isFinite(stats.C)).toBe(true);
    expect(Number.isFinite(stats.genreMedianPopularity)).toBe(true);

    const undergroundBand = { voteCountMin: 200, voteCountMax: 2000 };
    const included = sample.filter((m) => isHiddenGem(m, stats, undergroundBand));
    const includedIds = included.map((m) => m.id);

    // The obvious gem is included.
    expect(includedIds).toContain(7);

    // The blockbusters are excluded — both by the band ceiling AND by the
    // popularity gate.
    expect(includedIds).not.toContain(1);
    expect(includedIds).not.toContain(2);
    expect(includedIds).not.toContain(3);
  });
});
