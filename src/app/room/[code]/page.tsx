import { notFound } from "next/navigation";
import { ROOM_CODE_REGEX } from "@/lib/livekit/code-shared";
import { RoomWrapper } from "./RoomWrapper";

/**
 * Server-component wrapper for `/room/[code]`. Validates the code shape,
 * then hands off to a client wrapper that lazy-loads the LiveKit SDK.
 *
 * Splitting the wrapper out is a Next.js 15+ requirement: `next/dynamic` with
 * `ssr: false` must be called from a client component, not a server one.
 */

export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: raw } = await params;
  const code = raw.toUpperCase();

  // Cheap gate before we ship the LiveKit SDK to a caller with a malformed URL.
  // Server-side rejection ⇒ Next renders the framework 404 rather than the
  // client mounting and choking on an invalid code.
  if (!ROOM_CODE_REGEX.test(code)) {
    notFound();
  }

  return <RoomWrapper code={code} />;
}
