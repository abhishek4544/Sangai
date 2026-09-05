/**
 * Client-only helpers for stashing a freshly-minted LiveKit token between the
 * landing page (`/`) and the room page (`/room/[code]`). We put it in
 * sessionStorage — not localStorage — so it dies with the tab; a 10-minute-TTL
 * token has no business persisting past that anyway.
 *
 * Keyed by `session:room:<lowercased-code>`. Lowercased so a paste with weird
 * casing doesn't miss its own stash — the code itself is uppercase everywhere
 * on the wire.
 *
 * ALL functions here are safe to import into server components (they no-op
 * without `window`), but only the reads/writes are meaningful in the browser.
 */

export interface RoomSession {
  /** LiveKit AccessToken JWT. */
  token: string;
  /** LiveKit websocket URL (public — safe to store client-side). */
  url: string;
  /** Display name the user picked. Host may leave blank on create. */
  nickname: string;
  /** True if this session was created via POST /api/rooms (host). */
  isHost: boolean;
}

function keyFor(code: string): string {
  return `session:room:${code.toLowerCase()}`;
}

export function saveRoomSession(code: string, session: RoomSession): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(keyFor(code), JSON.stringify(session));
  } catch {
    // sessionStorage can throw in private mode / quota-exceeded. The room page
    // will bounce to `/?join=<code>` and the user can re-enter; not worth
    // surfacing an error at write-time.
  }
}

export function loadRoomSession(code: string): RoomSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(keyFor(code));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "token" in parsed &&
      "url" in parsed &&
      "nickname" in parsed &&
      "isHost" in parsed &&
      typeof (parsed as RoomSession).token === "string" &&
      typeof (parsed as RoomSession).url === "string" &&
      typeof (parsed as RoomSession).nickname === "string" &&
      typeof (parsed as RoomSession).isHost === "boolean"
    ) {
      return parsed as RoomSession;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearRoomSession(code: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(keyFor(code));
  } catch {
    // Same reasoning as save — swallow.
  }
}
