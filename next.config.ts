import type { NextConfig } from "next";

/**
 * Baseline security headers applied to every route. Added in the W-MVP
 * security review (docs/architecture/security-review-watch-together-mvp.md,
 * "High — No HTTP security headers on any route").
 *
 * Deliberately minimal:
 * - `X-Frame-Options: DENY` — no framing, closes clickjacking on the room
 *   page (which requests camera/mic and holds a LiveKit token in
 *   sessionStorage).
 * - `Referrer-Policy: strict-origin-when-cross-origin` — matches modern
 *   browser default; making it explicit avoids relying on a browser
 *   default that could change. Keeps the room-code path out of cross-
 *   origin Referer headers.
 * - `X-Content-Type-Options: nosniff` — belt-and-braces against MIME
 *   sniffing on any served asset.
 * - `Permissions-Policy` — restricts camera / microphone / display-capture
 *   / clipboard-write to the top-level origin only, so a nested iframe
 *   (if one is ever added) can't request these powerful APIs. The room
 *   page uses all three at the top level.
 *
 * NOT included (deliberately):
 * - `Content-Security-Policy` — worth adding, but the LiveKit websocket
 *   URL varies per environment (LIVEKIT_URL) and Next.js's inline runtime
 *   scripts need either 'unsafe-inline' or a per-request nonce. Both need
 *   careful iteration and were left as a follow-up in the security review.
 * - `Strict-Transport-Security` — Vercel sets this at the edge for the
 *   *.vercel.app / custom-domain deploys; adding it here would be
 *   duplicative on Vercel and only meaningful on a self-hosted deploy.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(self), microphone=(self), display-capture=(self), clipboard-write=(self), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "image.tmdb.org",
        pathname: "/t/p/**",
      },
    ],
  },
  async headers() {
    return [
      {
        // Apply to every route (pages + API). Next.js resolves this
        // pattern against the request path, not the filesystem.
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
