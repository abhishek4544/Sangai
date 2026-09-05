import { NextResponse } from "next/server";
import {
  DiscoverParamsSchema,
  TmdbError,
  discoverMovies,
} from "@/lib/tmdb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = {
    genre: searchParams.get("genre") ?? undefined,
    sort_by: searchParams.get("sort_by") ?? undefined,
    page: searchParams.get("page") ?? undefined,
  };

  const parsed = DiscoverParamsSchema.safeParse(raw);
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
    const data = await discoverMovies(parsed.data);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (err) {
    if (err instanceof TmdbError) {
      console.error("[tmdb]", err.message, { upstream: err.upstreamStatus });
      return NextResponse.json(
        { error: "movie_service_unavailable" },
        { status: err.status },
      );
    }
    // Narrow to message only — a future runtime change to fetch's error shape
    // could otherwise stringify the request URL, which carries `api_key=…`.
    const message = err instanceof Error ? err.message : "unknown";
    console.error("[discover]", message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
