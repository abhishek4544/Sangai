import { NextResponse } from "next/server";
import { SearchParamsSchema, TmdbError, searchMovies } from "@/lib/tmdb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Proxies TMDB /search/movie so the API key stays server-side. Fed by the
 *  Movie Picker's debounced search input; response is cached briefly to
 *  avoid re-hitting TMDB for the same typed query in the same session. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = {
    query: searchParams.get("query") ?? "",
    page: searchParams.get("page") ?? undefined,
  };

  const parsed = SearchParamsSchema.safeParse(raw);
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

  try {
    const data = await searchMovies(parsed.data);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    if (err instanceof TmdbError) {
      console.error("[tmdb-search]", err.message, {
        upstream: err.upstreamStatus,
      });
      return NextResponse.json(
        { error: "movie_service_unavailable" },
        { status: err.status },
      );
    }
    const message = err instanceof Error ? err.message : "unknown";
    console.error("[search]", message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
