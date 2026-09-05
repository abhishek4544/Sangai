/**
 * Pure, client-safe constants describing the room-code alphabet. No Node
 * imports here — this file is safe to pull into a client bundle (unlike
 * `./code.ts`, which imports `node:crypto`).
 *
 * The server-side code generator lives in `./code.ts` and re-exports these
 * constants so there's a single source of truth for the alphabet.
 */

/**
 * Room-code alphabet: uppercase alphanumeric excluding look-alikes (0/O, 1/I/L)
 * per CLAUDE.md. 31 characters. See ADR 0004 §"Room code generation".
 */
export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 6;

/**
 * Regex that matches a syntactically valid room code. Anchored, exact length,
 * only alphabet characters. Use to validate untrusted input before touching
 * LiveKit.
 */
export const ROOM_CODE_REGEX = new RegExp(
  `^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`,
);
