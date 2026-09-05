import "server-only";
import { RoomServiceClient } from "livekit-server-sdk";
import { env } from "@/lib/env";

/**
 * Singleton `RoomServiceClient`. Avoids reconstructing the client per request
 * (each construction sets up a Twirp RPC pipeline). Read env inside the
 * accessor so that a missing var fails at boot via `env.ts`, not lazily on
 * first request.
 *
 * The RoomServiceClient takes the LiveKit HTTP host (https://…), NOT the wss
 * URL that the browser client uses. LiveKit Cloud accepts the wss URL and
 * internally maps it, but be explicit — swap the scheme so we don't rely on
 * that convenience.
 */
let cached: RoomServiceClient | null = null;

export function getRoomService(): RoomServiceClient {
  if (cached) return cached;
  const httpUrl = env.LIVEKIT_URL.replace(/^wss:/, "https:").replace(
    /^ws:/,
    "http:",
  );
  cached = new RoomServiceClient(
    httpUrl,
    env.LIVEKIT_API_KEY,
    env.LIVEKIT_API_SECRET,
  );
  return cached;
}

/** Test-only: drop the cached client (e.g. if env changed mid-suite). */
export function __resetRoomServiceCache(): void {
  cached = null;
}
