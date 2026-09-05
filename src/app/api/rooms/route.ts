import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { ServerError } from "livekit-server-sdk";
import { z } from "zod";
import { env } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { generateRoomCode } from "@/lib/livekit/code";
import { getRoomService } from "@/lib/livekit/room-service";
import { mintAccessToken } from "@/lib/livekit/token";
import { checkRateLimit } from "@/lib/rate-limit";

// LiveKit server SDK needs Node crypto/streams — Edge runtime is insufficient.
// See ADR 0004 §"What runs where".
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Room open-time before the first participant joins (LiveKit `emptyTimeout`). */
const EMPTY_TIMEOUT_SECONDS = 60 * 10; // 10 min — matches PM AC2's idle grace.
/** Product decision (2026-09-05): rooms are for couples only — girlfriend +
 *  boyfriend, so exactly 2 participants max. Third joiner is rejected at
 *  the /join endpoint with a friendly "room full" message. */
const MAX_PARTICIPANTS = 2;
/** Rate-limit: 10 room creations per IP per hour (ADR 0004). */
const RATE_LIMIT = { limit: 10, windowMs: 60 * 60 * 1000 };
/** Cap on collision retries. See ADR 0004 §"Collision handling". */
const MAX_COLLISION_RETRIES = 5;
/** Matches client-side `NICKNAME_MAX` in src/app/page.tsx. */
const NICKNAME_MAX = 20;

/**
 * Body schema. `nickname` is OPTIONAL on create (host may fill it in later),
 * but if present it must be a non-empty string after trim and ≤ 20 chars.
 * Per ADR 0005 §8, when supplied the host's token is minted with `name` set
 * so `RoomClient.tsx` doesn't need a post-connect `setName` call.
 */
const CreateBodySchema = z.object({
  nickname: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: "Nickname cannot be whitespace-only." })
    .refine((s) => s.length <= NICKNAME_MAX, {
      message: `Nickname must be at most ${NICKNAME_MAX} characters.`,
    })
    .optional(),
});

/**
 * Resolve a stable per-client rate-limit key. Vercel populates
 * `x-forwarded-for` (the first entry is the client IP, subsequent entries are
 * intermediate proxies). We trust it because we run behind Vercel's edge; on
 * a self-hosted deploy behind an untrusted proxy this would be spoofable.
 *
 * Fallback when the header is missing: a hash of `user-agent + accept-language`.
 * This is a soft identifier — good enough to slow down a naive scraper on
 * local dev, useless against anyone who rotates headers. Documented on
 * purpose: proxy-trust is the classic rate-limiter footgun.
 */
function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff && xff.length > 0) {
    // Take only the first IP; the rest can be attacker-supplied via chained proxies.
    return xff.split(",", 1)[0]!.trim();
  }
  const ua = req.headers.get("user-agent") ?? "";
  const al = req.headers.get("accept-language") ?? "";
  return "fp:" + createHash("sha256").update(ua + "\n" + al).digest("hex").slice(0, 16);
}

/** Stable short identifier for logs — never log the raw IP or full UA. */
function hashForLog(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 10);
}

export async function POST(request: Request) {
  const ipKey = clientKey(request);

  // Rate limit before doing any work (or calling LiveKit).
  const rl = checkRateLimit(`rooms:create:${ipKey}`, RATE_LIMIT);
  if (!rl.allowed) {
    return jsonError(
      429,
      "rate_limited",
      { message: "Too many rooms created recently. Try again in a bit." },
      { headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  // Optional body: `{ nickname?: string }`. An empty body / non-JSON is still
  // allowed (create-without-nickname preserves the pre-ADR-0005 shape).
  let nickname: string | undefined;
  const contentLength = request.headers.get("content-length");
  const hasBody = contentLength !== null && contentLength !== "0";
  if (hasBody) {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError(400, "invalid_json", {
        message: "Request body must be JSON.",
      });
    }
    // Treat null/undefined body as "no nickname"; only parse objects.
    if (raw !== null && raw !== undefined) {
      const parsed = CreateBodySchema.safeParse(raw);
      if (!parsed.success) {
        return jsonError(400, "invalid_nickname", {
          message: `Nickname must be 1–${NICKNAME_MAX} characters after trimming.`,
        });
      }
      nickname = parsed.data.nickname;
    }
  }

  const roomService = getRoomService();

  let code: string | null = null;
  let lastCollisionErr: unknown = null;
  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    const candidate = generateRoomCode();
    try {
      await roomService.createRoom({
        name: candidate,
        emptyTimeout: EMPTY_TIMEOUT_SECONDS,
        maxParticipants: MAX_PARTICIPANTS,
      });
      code = candidate;
      break;
    } catch (err) {
      // LiveKit currently returns createRoom idempotently — if a room with
      // this name already exists, it typically returns the existing room, not
      // an error. But the ADR explicitly caps retries, so treat any error
      // here as a collision-esque failure and try a new code. We still log
      // the upstream status for diagnostics.
      lastCollisionErr = err;
      if (err instanceof ServerError) {
        console.error("[rooms.create]", {
          upstream_status: err.status,
          upstream_code: err.code,
          attempt,
          ip_hash: hashForLog(ipKey),
        });
      } else {
        const message = err instanceof Error ? err.message : "unknown";
        console.error("[rooms.create]", { message, attempt, ip_hash: hashForLog(ipKey) });
      }
      // Loop and try a fresh code.
    }
  }

  if (code === null) {
    // Retries exhausted — either the code space is genuinely saturated (not
    // plausible at 887M) or LiveKit is unreachable. Return 503 either way.
    const isServerErr = lastCollisionErr instanceof ServerError;
    console.error("[rooms.create] retries_exhausted", {
      ip_hash: hashForLog(ipKey),
      upstream_status: isServerErr
        ? (lastCollisionErr as ServerError).status
        : undefined,
    });
    return jsonError(503, "room_service_unavailable", {
      message: "Couldn't create a room right now. Try again in a moment.",
    });
  }

  let minted;
  try {
    // ADR 0005 §8: mint host token with `name` when supplied, so `setName`
    // isn't needed post-connect.
    minted = await mintAccessToken({ code, nickname });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error("[rooms.create] token_mint_failed", {
      code,
      message,
      ip_hash: hashForLog(ipKey),
    });
    return jsonError(500, "internal_error");
  }

  return NextResponse.json({
    code,
    token: minted.token,
    url: env.LIVEKIT_URL,
  });
}
