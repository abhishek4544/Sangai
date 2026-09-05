import { NextResponse } from "next/server";
import { z } from "zod";
import {
  TMDB_GENRE_IDS,
  TmdbError,
  discoverMovies,
  type Movie,
} from "@/lib/tmdb";
import { computeStats, isHiddenGem } from "@/lib/hidden-gem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  genre: z.coerce
    .number()
    .int()
    .refine((n) => (TMDB_GENRE_IDS as readonly number[]).includes(n), {
      message: "Unknown TMDB genre id",
    }),
  obscurity: z.coerce.number().int().min(0).max(3),
});

// Obscurity → vote-count band. Server constants; the client never sees these.
// Per ADR 0003 slider mapping table.
const OBSCURITY_BANDS = [
  { voteCountMin: 1000, voteCountMax: 10000 }, // 0 Mainstream
  { voteCountMin: 500, voteCountMax: 5000 }, //   1 Mixed
  { voteCountMin: 200, voteCountMax: 2000 }, //   2 Underground
  { voteCountMin: 50, voteCountMax: 500 }, //     3 Deep cut
] as const;

type GemsResponse = {
  results: Movie[];
  stats: { C: number; genreMedianPopularity: number; sampleSize: number };
  obscurity: number;
};

type CacheEntry = { data: GemsResponse; expiresAt: number };

const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 128;

const cacheKey = (genre: number, obscurity: number) => `${genre}:${obscurity}`;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = {
    genre: searchParams.get("genre") ?? undefined,
    obscurity: searchParams.get("obscurity") ?? undefined,
  };

  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_params",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  const { genre, obscurity } = parsed.data;
  const key = cacheKey(genre, obscurity);

  const now = Date.now();
  const cached = CACHE.get(key);
  if (cached) {
    if (cached.expiresAt > now) {
      return NextResponse.json(cached.data, {
        headers: { "Cache-Control": "private, max-age=30" },
      });
    }
    CACHE.delete(key);
  }

  try {
    // Parallel fan-out — ~60 movies total. If any page rejects, the whole
    // request fails: a half-sample would bias C and the genre median.
    const pages = await Promise.all([
      discoverMovies({ genre, sort_by: "popularity.desc", page: 1 }),
      discoverMovies({ genre, sort_by: "popularity.desc", page: 2 }),
      discoverMovies({ genre, sort_by: "popularity.desc", page: 3 }),
    ]);
    const sample = pages.flatMap((p) => p.results);

    const band = OBSCURITY_BANDS[obscurity];
    const stats = computeStats(sample);
    const gems = sample.filter((m) => isHiddenGem(m, stats, band));
    const results = gems.slice(0, 20);

    const data: GemsResponse = { results, stats, obscurity };

    // FIFO eviction — the Map iterates in insertion order.
    if (CACHE.size >= CACHE_MAX) {
      const oldest = CACHE.keys().next().value;
      if (oldest !== undefined) CACHE.delete(oldest);
    }
    CACHE.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });

    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (err) {
    if (err instanceof TmdbError) {
      console.error("[gems]", err.message, { upstream: err.upstreamStatus });
      return NextResponse.json(
        { error: "movie_service_unavailable" },
        { status: err.status },
      );
    }
    // Narrow to message only — a future runtime change to fetch's error shape
    // could otherwise stringify the request URL, which carries `api_key=…`.
    const message = err instanceof Error ? err.message : "unknown";
    console.error("[gems]", message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
