import "server-only";
import { z } from "zod";
import { env } from "./env";

export const TMDB_GENRE_IDS = [
  28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 10770,
  53, 10752, 37,
] as const;

export const TMDB_SORT_VALUES = [
  "popularity.desc",
  "popularity.asc",
  "vote_average.desc",
  "vote_average.asc",
  "primary_release_date.desc",
  "primary_release_date.asc",
  "revenue.desc",
  "revenue.asc",
] as const;

export const DiscoverParamsSchema = z.object({
  genre: z.coerce
    .number()
    .int()
    .refine((n) => (TMDB_GENRE_IDS as readonly number[]).includes(n), {
      message: "Unknown TMDB genre id",
    })
    .optional(),
  sort_by: z.enum(TMDB_SORT_VALUES).default("popularity.desc"),
  page: z.coerce.number().int().min(1).max(500).default(1),
  "vote_count.gte": z.coerce.number().int().min(0).optional(),
  "vote_count.lte": z.coerce.number().int().min(0).optional(),
});

export type DiscoverParams = z.infer<typeof DiscoverParamsSchema>;

const MovieSchema = z.object({
  id: z.number(),
  title: z.string(),
  poster_path: z.string().nullable(),
  vote_average: z.number(),
  vote_count: z.number(),
  popularity: z.number(),
  release_date: z.string().optional().nullable(),
});

const DiscoverResponseSchema = z.object({
  page: z.number(),
  total_pages: z.number(),
  total_results: z.number(),
  results: z.array(MovieSchema),
});

export type Movie = z.infer<typeof MovieSchema>;
export type DiscoverResponse = z.infer<typeof DiscoverResponseSchema>;

export class TmdbError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = "TmdbError";
  }
}

export async function discoverMovies(
  params: DiscoverParams,
): Promise<DiscoverResponse> {
  const url = new URL("/3/discover/movie", "https://api.themoviedb.org");
  url.searchParams.set("api_key", env.TMDB_API_KEY);
  url.searchParams.set("sort_by", params.sort_by);
  url.searchParams.set("page", String(params.page));
  url.searchParams.set("include_adult", "false");
  if (params.genre !== undefined) {
    url.searchParams.set("with_genres", String(params.genre));
  }
  if (params["vote_count.gte"] !== undefined) {
    url.searchParams.set("vote_count.gte", String(params["vote_count.gte"]));
  }
  if (params["vote_count.lte"] !== undefined) {
    url.searchParams.set("vote_count.lte", String(params["vote_count.lte"]));
  }

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });

  if (res.status === 401) {
    throw new TmdbError("TMDB rejected the API key", 502, 401);
  }
  if (!res.ok) {
    throw new TmdbError(
      `TMDB request failed (${res.status})`,
      502,
      res.status,
    );
  }

  const json = await res.json();
  const parsed = DiscoverResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new TmdbError("TMDB returned an unexpected response shape", 502);
  }
  return parsed.data;
}

export function posterUrl(path: string | null, size: "w500" = "w500"): string | null {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

