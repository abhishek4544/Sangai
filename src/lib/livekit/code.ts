import { randomBytes } from "node:crypto";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_CODE_REGEX,
} from "./code-shared";

// Re-export so existing server-side imports (`@/lib/livekit/code`) keep working
// unchanged. The alphabet + regex + length are defined once in `code-shared.ts`
// and imported here — client bundles pull from `code-shared` directly to avoid
// dragging `node:crypto` into the browser.
export { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_CODE_REGEX };

// Modulo-bias rejection threshold. 256 % 31 = 8, so the largest multiple of
// 31 that fits in a byte is 31 * 8 = 248. We reject bytes >= 248 and redraw.
const ALPHABET_SIZE = ROOM_CODE_ALPHABET.length; // 31
const REJECTION_THRESHOLD = 256 - (256 % ALPHABET_SIZE); // 248

/**
 * Generate a cryptographically random room code. Uses rejection sampling to
 * eliminate modulo bias so every code is equally likely.
 *
 * 31^6 ≈ 887M distinct codes; collisions with an existing LiveKit room are
 * astronomically rare at MVP scale (≤ 100 concurrent rooms → ~1 in 8.9M).
 * The caller still retries on collision — see ADR 0004.
 */
export function generateRoomCode(): string {
  const chars: string[] = new Array(ROOM_CODE_LENGTH);
  let filled = 0;

  // Draw in small batches; on average <1% of bytes are rejected so a
  // single 12-byte draw covers 6 positions ~99% of the time.
  while (filled < ROOM_CODE_LENGTH) {
    const need = ROOM_CODE_LENGTH - filled;
    // Over-draw a little to reduce loop iterations under rejection.
    const buf = randomBytes(need * 2);
    for (let i = 0; i < buf.length && filled < ROOM_CODE_LENGTH; i++) {
      const b = buf[i]!;
      if (b >= REJECTION_THRESHOLD) continue;
      chars[filled++] = ROOM_CODE_ALPHABET[b % ALPHABET_SIZE]!;
    }
  }

  return chars.join("");
}
