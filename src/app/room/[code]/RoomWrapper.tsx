"use client";

import dynamic from "next/dynamic";

/**
 * Client-side dynamic import for the LiveKit-heavy room UI. Kept as a thin
 * shim so the server component can render the framework 404 for a bad code
 * without ever touching this bundle.
 *
 * `ssr: false` is what actually keeps `livekit-client` out of the landing-page
 * bundle — the SDK ships only on this route, and only client-side.
 */
const RoomClient = dynamic(() => import("./RoomClient"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-sm text-zinc-400">
      Loading room…
    </div>
  ),
});

export function RoomWrapper({ code }: { code: string }) {
  return <RoomClient code={code} />;
}
