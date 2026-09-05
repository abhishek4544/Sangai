import { beforeAll, describe, expect, it } from "vitest";

// Env has to be set BEFORE importing anything that transitively imports
// `@/lib/env` — env.ts validates at module load and throws otherwise.
beforeAll(() => {
  process.env.TMDB_API_KEY ??= "test-tmdb-key";
  process.env.LIVEKIT_URL ??= "wss://test.livekit.cloud";
  process.env.LIVEKIT_API_KEY ??= "test-api-key";
  process.env.LIVEKIT_API_SECRET ??=
    "test-secret-must-be-at-least-32-chars-long-yes";
});

// Import lazily so the env-var assignment above happens first.
async function loadToken() {
  return await import("./token");
}

function decodeJwt(jwt: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
} {
  const [h, p] = jwt.split(".");
  if (!h || !p) throw new Error("not a JWT");
  const b64urlToJson = (s: string): Record<string, unknown> => {
    // Node's Buffer handles base64url natively via "base64url".
    const json = Buffer.from(s, "base64url").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  };
  return { header: b64urlToJson(h), payload: b64urlToJson(p) };
}

describe("mintAccessToken", () => {
  it("returns a syntactically valid JWT (three base64url segments)", async () => {
    const { mintAccessToken } = await loadToken();
    const { token } = await mintAccessToken({ code: "ABC234" });
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(p.length).toBeGreaterThan(0);
  });

  it("uses HS256 for signing", async () => {
    const { mintAccessToken } = await loadToken();
    const { token } = await mintAccessToken({ code: "ABC234" });
    const { header } = decodeJwt(token);
    expect(header.alg).toBe("HS256");
    // Note: livekit-server-sdk v2 emits a minimal header (no `typ`). Standard
    // JWT parsers treat a missing `typ` as "JWT" by convention; LiveKit's own
    // client accepts it. Do not assert `typ` here — that used to fail against
    // the real SDK output.
  });

  it("carries the expected VideoGrant claims and identity", async () => {
    const { mintAccessToken } = await loadToken();
    const { token, identity } = await mintAccessToken({
      code: "ABC234",
      nickname: "sam",
    });
    const { payload } = decodeJwt(token);

    // `sub` holds identity in LiveKit tokens.
    expect(payload.sub).toBe(identity);
    expect(typeof identity).toBe("string");
    // Rough UUID shape check.
    expect(identity).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    expect(payload.name).toBe("sam");

    const video = payload.video as Record<string, unknown>;
    expect(video).toBeDefined();
    expect(video.roomJoin).toBe(true);
    expect(video.room).toBe("ABC234");
    expect(video.canPublish).toBe(true);
    expect(video.canSubscribe).toBe(true);
    // ADR 0005 §1, §8: Phase 2 opens the data channel for room-wide events
    // (reactions, hold, whisper, cards) and the own-metadata surface for
    // participant attributes (force-on mic).
    expect(video.canPublishData).toBe(true);
    expect(video.canUpdateOwnMetadata).toBe(true);
  });

  it("omits `name` when no nickname is given (create-room flow)", async () => {
    const { mintAccessToken } = await loadToken();
    const { token } = await mintAccessToken({ code: "ABC234" });
    const { payload } = decodeJwt(token);
    expect(payload.name).toBeUndefined();
  });

  it("respects the 10-minute TTL", async () => {
    const { mintAccessToken, TOKEN_TTL_SECONDS } = await loadToken();
    expect(TOKEN_TTL_SECONDS).toBe(600);

    // livekit-server-sdk v2 emits `nbf` (not-before) + `exp`, not `iat`.
    // TTL correctness is `exp - nbf === TOKEN_TTL_SECONDS`.
    const before = Math.floor(Date.now() / 1000);
    const { token } = await mintAccessToken({ code: "ABC234" });
    const after = Math.floor(Date.now() / 1000);
    const { payload } = decodeJwt(token);

    const nbf = payload.nbf as number;
    const exp = payload.exp as number;
    expect(typeof nbf).toBe("number");
    expect(typeof exp).toBe("number");
    expect(nbf).toBeGreaterThanOrEqual(before);
    expect(nbf).toBeLessThanOrEqual(after);
    expect(exp - nbf).toBe(TOKEN_TTL_SECONDS);
  });

  it("mints a fresh identity for each call", async () => {
    const { mintAccessToken } = await loadToken();
    const a = await mintAccessToken({ code: "ABC234" });
    const b = await mintAccessToken({ code: "ABC234" });
    expect(a.identity).not.toBe(b.identity);
    expect(a.token).not.toBe(b.token);
  });
});
