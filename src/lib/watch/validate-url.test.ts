import { describe, it, expect } from "vitest";
import { validateWatchUrl, isWatchEventFresh, UPDATED_AT_MAX_MS } from "./validate-url";

// ---- Happy paths: accepted YouTube URL shapes ------------------------------

describe("validateWatchUrl — accepted YouTube URLs", () => {
  it("accepts standard watch URL (www.youtube.com/watch?v=)", () => {
    const r = validateWatchUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(r).toEqual({ ok: true, providerId: "youtube", mediaId: "dQw4w9WgXcQ" });
  });

  it("accepts bare youtube.com/watch?v=", () => {
    const r = validateWatchUrl("https://youtube.com/watch?v=dQw4w9WgXcQ");
    expect(r).toEqual({ ok: true, providerId: "youtube", mediaId: "dQw4w9WgXcQ" });
  });

  it("accepts mobile m.youtube.com/watch?v=", () => {
    const r = validateWatchUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(r).toEqual({ ok: true, providerId: "youtube", mediaId: "dQw4w9WgXcQ" });
  });

  it("accepts youtu.be short link", () => {
    const r = validateWatchUrl("https://youtu.be/dQw4w9WgXcQ");
    expect(r).toEqual({ ok: true, providerId: "youtube", mediaId: "dQw4w9WgXcQ" });
  });

  it("accepts youtube.com/shorts/", () => {
    const r = validateWatchUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ");
    expect(r).toEqual({ ok: true, providerId: "youtube", mediaId: "dQw4w9WgXcQ" });
  });

  it("accepts youtube.com/embed/", () => {
    const r = validateWatchUrl("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(r).toEqual({ ok: true, providerId: "youtube", mediaId: "dQw4w9WgXcQ" });
  });

  it("accepts youtube-nocookie.com/watch?v=", () => {
    const r = validateWatchUrl("https://www.youtube-nocookie.com/watch?v=dQw4w9WgXcQ");
    expect(r).toEqual({ ok: true, providerId: "youtube", mediaId: "dQw4w9WgXcQ" });
  });

  it("accepts music.youtube.com/watch?v=", () => {
    const r = validateWatchUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(r).toEqual({ ok: true, providerId: "youtube", mediaId: "dQw4w9WgXcQ" });
  });

  it("strips all other query params — only the ID is returned (M5 remediation)", () => {
    const r = validateWatchUrl(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&autoplay=1&t=42&list=PL123",
    );
    expect(r).toEqual({ ok: true, providerId: "youtube", mediaId: "dQw4w9WgXcQ" });
  });

  it("same mediaId regardless of URL shape", () => {
    const id = "dQw4w9WgXcQ";
    const urls = [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
    ];
    for (const url of urls) {
      const r = validateWatchUrl(url);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.mediaId).toBe(id);
    }
  });
});

// ---- Rejection: too_long ---------------------------------------------------

describe("validateWatchUrl — too_long", () => {
  it("rejects input longer than 2048 chars", () => {
    const r = validateWatchUrl("https://www.youtube.com/watch?v=" + "a".repeat(2048));
    expect(r).toEqual({ ok: false, reason: "too_long" });
  });

  it("accepts exactly 2048 chars (no rejection)", () => {
    // Build a URL that is exactly 2048 chars and still parses. The mediaId
    // will be wrong so it will fail at invalid_media_id, not too_long.
    const prefix = "https://www.youtube.com/watch?v=";
    const padding = "a".repeat(2048 - prefix.length);
    const r = validateWatchUrl(prefix + padding);
    expect(r).not.toEqual({ ok: false, reason: "too_long" });
  });
});

// ---- Rejection: malformed --------------------------------------------------

describe("validateWatchUrl — malformed", () => {
  it("rejects completely non-URL strings", () => {
    expect(validateWatchUrl("not a url at all")).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects empty string", () => {
    expect(validateWatchUrl("")).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a bare hostname with no scheme", () => {
    expect(validateWatchUrl("youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});

// ---- Rejection: not_https --------------------------------------------------

describe("validateWatchUrl — not_https", () => {
  it("rejects http://", () => {
    expect(validateWatchUrl("http://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      ok: false,
      reason: "not_https",
    });
  });

  it("rejects javascript: protocol", () => {
    expect(validateWatchUrl("javascript:alert(1)")).toEqual({
      ok: false,
      reason: "not_https",
    });
  });

  it("rejects data: protocol", () => {
    expect(validateWatchUrl("data:text/html,<h1>evil</h1>")).toEqual({
      ok: false,
      reason: "not_https",
    });
  });

  it("rejects file: protocol", () => {
    expect(validateWatchUrl("file:///etc/passwd")).toEqual({
      ok: false,
      reason: "not_https",
    });
  });

  it("rejects blob: protocol", () => {
    expect(validateWatchUrl("blob:https://example.com/uuid")).toEqual({
      ok: false,
      reason: "not_https",
    });
  });
});

// ---- Rejection: blocked_host -----------------------------------------------

describe("validateWatchUrl — blocked_host (RFC1918 / loopback / link-local)", () => {
  it("rejects localhost", () => {
    expect(validateWatchUrl("https://localhost/evil")).toEqual({
      ok: false,
      reason: "blocked_host",
    });
  });

  it("rejects ip6-localhost", () => {
    expect(validateWatchUrl("https://ip6-localhost/evil")).toEqual({
      ok: false,
      reason: "blocked_host",
    });
  });

  it("rejects .local suffix", () => {
    expect(validateWatchUrl("https://myservice.local/evil")).toEqual({
      ok: false,
      reason: "blocked_host",
    });
  });

  it("rejects 127.0.0.1 loopback", () => {
    expect(validateWatchUrl("https://127.0.0.1/evil")).toEqual({
      ok: false,
      reason: "blocked_host",
    });
  });

  it("rejects 127.255.0.1 (127.0.0.0/8)", () => {
    expect(validateWatchUrl("https://127.255.0.1/evil")).toEqual({
      ok: false,
      reason: "blocked_host",
    });
  });

  it("rejects 10.0.0.1 (RFC1918)", () => {
    expect(validateWatchUrl("https://10.0.0.1/internal")).toEqual({
      ok: false,
      reason: "blocked_host",
    });
  });

  it("rejects 10.255.255.255 (RFC1918)", () => {
    expect(validateWatchUrl("https://10.255.255.255/x")).toEqual({
      ok: false,
      reason: "blocked_host",
    });
  });

  it("rejects 172.16.0.1 (172.16.0.0/12)", () => {
    expect(validateWatchUrl("https://172.16.0.1/x")).toEqual({
      ok: false,
      reason: "blocked_host",
    });
  });

  it("rejects 172.31.255.255 (172.16.0.0/12)", () => {
    expect(validateWatchUrl("https://172.31.255.255/x")).toEqual({
      ok: false,
      reason: "blocked_host",
    });
  });

  it("does not block 172.15.0.1 (just outside the /12 range)", () => {
    // 172.15.* is not RFC1918; it's a legitimate public range. The URL will
    // fail at unknown_provider (not a YouTube host), not blocked_host.
    const r = validateWatchUrl("https://172.15.0.1/x");
    expect(r).toEqual({ ok: false, reason: "unknown_provider" });
  });

  it("rejects 192.168.1.1 (RFC1918)", () => {
    expect(validateWatchUrl("https://192.168.1.1/private")).toEqual({
      ok: false,
      reason: "blocked_host",
    });
  });

  it("rejects 169.254.1.1 link-local", () => {
    expect(validateWatchUrl("https://169.254.1.1/link-local")).toEqual({
      ok: false,
      reason: "blocked_host",
    });
  });

  it("rejects [::1] IPv6 loopback", () => {
    expect(validateWatchUrl("https://[::1]/evil")).toEqual({
      ok: false,
      reason: "blocked_host",
    });
  });

  it("rejects [fc00::1] ULA IPv6", () => {
    expect(validateWatchUrl("https://[fc00::1]/evil")).toEqual({
      ok: false,
      reason: "blocked_host",
    });
  });

  it("rejects [fd00::1] ULA IPv6 (fd prefix ⊂ fc00::/7)", () => {
    expect(validateWatchUrl("https://[fd00::1]/evil")).toEqual({
      ok: false,
      reason: "blocked_host",
    });
  });

  it("rejects [fe80::1] link-local IPv6", () => {
    expect(validateWatchUrl("https://[fe80::1]/evil")).toEqual({
      ok: false,
      reason: "blocked_host",
    });
  });

  it("rejects punycode (xn--) hostname — M2 non-ASCII host remediation", () => {
    // xn-- ACE labels indicate a non-ASCII IDN that could be a homograph.
    // Explicitly blocked so IDN spoofing of youtube.com is impossible.
    const r = validateWatchUrl("https://xn--youtube-9f43d.com/watch?v=dQw4w9WgXcQ");
    expect(r).toEqual({ ok: false, reason: "blocked_host" });
  });
});

// ---- Rejection: unknown_provider -------------------------------------------

describe("validateWatchUrl — unknown_provider", () => {
  it("rejects netflix.com", () => {
    expect(validateWatchUrl("https://www.netflix.com/watch/12345")).toEqual({
      ok: false,
      reason: "unknown_provider",
    });
  });

  it("rejects twitch.tv", () => {
    expect(validateWatchUrl("https://www.twitch.tv/videos/123")).toEqual({
      ok: false,
      reason: "unknown_provider",
    });
  });

  it("rejects vimeo.com", () => {
    expect(validateWatchUrl("https://vimeo.com/123456789")).toEqual({
      ok: false,
      reason: "unknown_provider",
    });
  });

  it("rejects example.com", () => {
    expect(validateWatchUrl("https://example.com/video")).toEqual({
      ok: false,
      reason: "unknown_provider",
    });
  });
});

// ---- Rejection: invalid_media_id -------------------------------------------

describe("validateWatchUrl — invalid_media_id", () => {
  it("rejects YouTube playlist URL (no video ID)", () => {
    const r = validateWatchUrl("https://www.youtube.com/playlist?list=PLsome");
    expect(r).toEqual({ ok: false, reason: "invalid_media_id" });
  });

  it("rejects YouTube channel URL", () => {
    const r = validateWatchUrl("https://www.youtube.com/@SomeChannel");
    expect(r).toEqual({ ok: false, reason: "invalid_media_id" });
  });

  it("rejects mediaId shorter than 11 chars (10 chars)", () => {
    const r = validateWatchUrl("https://www.youtube.com/watch?v=dQw4w9WgXc");
    expect(r).toEqual({ ok: false, reason: "invalid_media_id" });
  });

  it("rejects mediaId longer than 11 chars (12 chars)", () => {
    const r = validateWatchUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQQ");
    expect(r).toEqual({ ok: false, reason: "invalid_media_id" });
  });

  it("rejects mediaId with invalid character (space)", () => {
    const r = validateWatchUrl("https://www.youtube.com/watch?v=dQw4w9WgX Q");
    // The space in a URL query param gets encoded by the browser but here we
    // test the raw string — URL() will encode it, the v param then contains a
    // space which fails the regex.
    expect(r).toEqual({ ok: false, reason: "invalid_media_id" });
  });

  it("rejects mediaId with invalid character (dot)", () => {
    const r = validateWatchUrl("https://www.youtube.com/watch?v=dQw4w9WgX.Q");
    expect(r).toEqual({ ok: false, reason: "invalid_media_id" });
  });

  it("accepts mediaId with all allowed chars including _ and -", () => {
    const r = validateWatchUrl("https://www.youtube.com/watch?v=_Qw4w9WgX-Q");
    expect(r).toEqual({ ok: true, providerId: "youtube", mediaId: "_Qw4w9WgX-Q" });
  });

  it("rejects bare youtu.be/ with no path segment", () => {
    const r = validateWatchUrl("https://youtu.be/");
    expect(r).toEqual({ ok: false, reason: "invalid_media_id" });
  });
});

// ---- isWatchEventFresh (H2 runtime skew cap) -------------------------------

describe("isWatchEventFresh", () => {
  it("accepts updatedAt equal to nowMs", () => {
    const now = Date.now();
    expect(isWatchEventFresh({ updatedAt: now }, now)).toBe(true);
  });

  it("accepts updatedAt 4 minutes in the future (within 5-min skew cap)", () => {
    const now = Date.now();
    expect(isWatchEventFresh({ updatedAt: now + 4 * 60 * 1000 }, now)).toBe(true);
  });

  it("rejects updatedAt 10 minutes in the future (H2 boundary test)", () => {
    const now = Date.now();
    expect(isWatchEventFresh({ updatedAt: now + 10 * 60 * 1000 }, now)).toBe(false);
  });

  it("rejects updatedAt exactly 5 minutes + 1 ms in the future", () => {
    const now = Date.now();
    expect(isWatchEventFresh({ updatedAt: now + 5 * 60 * 1000 + 1 }, now)).toBe(false);
  });

  it("accepts updatedAt in the past", () => {
    const now = Date.now();
    expect(isWatchEventFresh({ updatedAt: now - 60_000 }, now)).toBe(true);
  });

  it("accepts updatedAt: 0 (unix epoch)", () => {
    expect(isWatchEventFresh({ updatedAt: 0 }, Date.now())).toBe(true);
  });

  it("UPDATED_AT_MAX_MS constant is the year-2100 boundary", () => {
    // Confirm the constant is what we think it is so the schema max() is meaningful.
    expect(UPDATED_AT_MAX_MS).toBe(4_102_444_800_000);
  });
});
