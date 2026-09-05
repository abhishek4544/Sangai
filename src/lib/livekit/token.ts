import "server-only";
import { randomUUID } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import { env } from "@/lib/env";

/**
 * TTL for the join token, in seconds. 10 minutes per ADR 0004: the token only
 * needs to survive from mint to `room.connect()`; once connected, LiveKit's
 * session (not the token) keeps the participant in the room.
 */
export const TOKEN_TTL_SECONDS = 60 * 10;

export interface MintTokenArgs {
  /** Room code the participant is joining. Must already be validated. */
  code: string;
  /**
   * Optional display nickname. Set for `join` (client entered one); left
   * undefined for `create` (host fills it later on the join UI). Nickname
   * is display-only and never trusted — see CLAUDE.md.
   */
  nickname?: string;
}

export interface MintedToken {
  token: string;
  /** The randomly-generated identity — useful if the caller wants to log it (hashed). */
  identity: string;
}

/**
 * Mint a room-scoped, short-TTL LiveKit AccessToken.
 *
 * Grants (per ADR 0004 §"LiveKit token — scope + TTL" and ADR 0005 §8):
 * - roomJoin, room: <code>
 * - canPublish (covers camera, mic, screen-share, screen-share-audio — same source)
 * - canSubscribe
 * - canPublishData: true (ADR 0005 §1 — data channel is Phase-2 signaling substrate)
 * - canUpdateOwnMetadata: true (ADR 0005 §8 — enables setName + setAttributes)
 *
 * Identity is a per-session UUID, NOT the nickname. Duplicate nicknames are
 * allowed; UUID is what keeps two "sam"s distinct on the wire.
 */
export async function mintAccessToken({
  code,
  nickname,
}: MintTokenArgs): Promise<MintedToken> {
  const identity = randomUUID();
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity,
    ttl: TOKEN_TTL_SECONDS,
    ...(nickname !== undefined ? { name: nickname } : {}),
  });
  at.addGrant({
    roomJoin: true,
    room: code,
    canPublish: true,
    canSubscribe: true,
    // ADR 0005 §1: data channel is the Phase-2 signaling substrate (reactions, hold, whisper, cards).
    canPublishData: true,
    // ADR 0005 §8: covers setName + setAttributes (participant attributes ride the own-metadata grant).
    canUpdateOwnMetadata: true,
  });
  const token = await at.toJwt();
  return { token, identity };
}
