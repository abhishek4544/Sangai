import type { Movie } from "./tmdb";

// WR floor from CLAUDE.md hidden-gem formula.
export const GEM_THRESHOLD = 7.2;
// `m` in the WR formula; CLAUDE.md says "tune this" — 300 is the M2 seed.
export const M_VOTE_FLOOR = 300;

/**
 * IMDb-style weighted rating.
 *
 *   WR = (v / (v + m)) * R + (m / (v + m)) * C
 *
 * Guards against `v + m === 0` by returning `C` (the prior).
 */
export function weightedRating(input: {
  R: number;
  v: number;
  m: number;
  C: number;
}): number {
  const { R, v, m, C } = input;
  const denom = v + m;
  if (denom === 0) return C;
  return (v / denom) * R + (m / denom) * C;
}

/**
 * Compute sample statistics used by the gem gate.
 *
 * `C` — arithmetic mean of `vote_average` across the sample.
 * `genreMedianPopularity` — median of `popularity` (sorted copy; input is not mutated).
 * `sampleSize` — number of movies in the sample.
 *
 * Empty sample → all zeros.
 */
export function computeStats(
  movies: ReadonlyArray<Movie>,
): { C: number; genreMedianPopularity: number; sampleSize: number } {
  const sampleSize = movies.length;
  if (sampleSize === 0) {
    return { C: 0, genreMedianPopularity: 0, sampleSize: 0 };
  }

  let voteSum = 0;
  for (const m of movies) voteSum += m.vote_average;
  const C = voteSum / sampleSize;

  const popsSorted = movies.map((m) => m.popularity).sort((a, b) => a - b);
  const mid = Math.floor(popsSorted.length / 2);
  const genreMedianPopularity =
    popsSorted.length % 2 === 0
      ? (popsSorted[mid - 1] + popsSorted[mid]) / 2
      : popsSorted[mid];

  return { C, genreMedianPopularity, sampleSize };
}

/**
 * Full CLAUDE.md gate: WR >= threshold AND vote_count in band
 * AND popularity < genre-median-popularity.
 */
export function isHiddenGem(
  movie: Movie,
  stats: { C: number; genreMedianPopularity: number },
  opts: {
    voteCountMin: number;
    voteCountMax: number;
    gemThreshold?: number;
    m?: number;
  },
): boolean {
  const threshold = opts.gemThreshold ?? GEM_THRESHOLD;
  const m = opts.m ?? M_VOTE_FLOOR;

  const wr = weightedRating({
    R: movie.vote_average,
    v: movie.vote_count,
    m,
    C: stats.C,
  });
  if (wr < threshold) return false;

  if (movie.vote_count < opts.voteCountMin) return false;
  if (movie.vote_count > opts.voteCountMax) return false;

  if (movie.popularity >= stats.genreMedianPopularity) return false;

  return true;
}
