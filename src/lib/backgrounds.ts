/**
 * Cinema-background catalog — TICKET-3 (Week 1). Both participants pick one
 * scene; selection is a room-wide LWW field (`state.ts:backgroundId`), synced
 * via the `background.pick` data-channel event, and mirrored to localStorage
 * per room code so re-entry keeps the last pick.
 *
 * Every entry renders as: full-viewport `background` CSS on the outer room
 * container, PLUS an optional grass/foreground overlay for scenes that want a
 * grounded horizon. Kept as pure-CSS defs (no image assets) for four of five
 * scenes so the feature ships without waiting on art. `grass` keeps the
 * existing `/grass.png` so the default look is unchanged.
 */
export interface BackgroundDef {
  id: string;
  label: string;
  /** Emoji preview shown in the picker; cheap stand-in for a thumbnail. */
  glyph: string;
  /** `background` CSS shorthand for the outer sky/scene. */
  sky: string;
  /** Optional grass/foreground CSS (bottom strip). `null` = no foreground. */
  foreground: string | null;
  /** Optional cloud overlay CSS — only `grass` keeps the soft-cloud puffs. */
  cloudsOverlay: string | null;
}

export const BACKGROUNDS: BackgroundDef[] = [
  {
    id: "grass",
    label: "Sunny meadow",
    glyph: "🌤",
    sky: "linear-gradient(to bottom, #bce8ff 0%, #9adaff 55%, #7dccff 100%)",
    foreground:
      "url('/grass.png') bottom center / cover no-repeat",
    cloudsOverlay: [
      "radial-gradient(ellipse 55% 32% at 18% 22%, rgba(255,255,255,0.55), transparent 70%)",
      "radial-gradient(ellipse 45% 26% at 68% 14%, rgba(255,255,255,0.5), transparent 70%)",
      "radial-gradient(ellipse 38% 30% at 42% 45%, rgba(255,255,255,0.32), transparent 70%)",
      "radial-gradient(ellipse 50% 28% at 88% 40%, rgba(255,255,255,0.42), transparent 70%)",
    ].join(","),
  },
  {
    id: "beach-sunset",
    label: "Beach sunset",
    glyph: "🌅",
    sky: "linear-gradient(to bottom, #ffb37a 0%, #ff8a6b 35%, #f27389 60%, #7d5fa8 100%)",
    foreground:
      "linear-gradient(to top, rgba(30,20,60,0.85) 0%, rgba(30,20,60,0.55) 45%, transparent 100%)",
    cloudsOverlay: null,
  },
  {
    id: "midnight-garden",
    label: "Midnight garden",
    glyph: "🌙",
    // Deep-blue night with a soft moon-glow up top.
    sky: [
      "radial-gradient(circle at 82% 18%, rgba(255,247,214,0.75) 0%, rgba(255,247,214,0.15) 8%, transparent 18%)",
      "linear-gradient(to bottom, #0f1a3d 0%, #1a2560 55%, #24306d 100%)",
    ].join(","),
    foreground:
      "linear-gradient(to top, rgba(6,10,25,0.9) 0%, rgba(6,10,25,0.45) 55%, transparent 100%)",
    cloudsOverlay: null,
  },
  {
    id: "drive-in",
    label: "Drive-in theater",
    glyph: "🎬",
    // Dusk sky, cool horizon → warm dust up top.
    sky: "linear-gradient(to bottom, #2a1f4a 0%, #5b3a6b 40%, #b26977 70%, #f0a56a 100%)",
    foreground:
      "linear-gradient(to top, rgba(10,10,20,0.95) 0%, rgba(10,10,20,0.6) 40%, transparent 100%)",
    cloudsOverlay: null,
  },
  {
    id: "campfire",
    label: "Campfire",
    glyph: "🔥",
    // Warm ember glow bottom-center, deep-blue night above.
    sky: [
      "radial-gradient(ellipse 60% 40% at 50% 100%, rgba(255,140,50,0.55) 0%, rgba(255,90,40,0.3) 30%, transparent 65%)",
      "linear-gradient(to bottom, #0a1030 0%, #1a1550 60%, #2a1548 100%)",
    ].join(","),
    foreground:
      "linear-gradient(to top, rgba(10,5,20,0.95) 0%, rgba(10,5,20,0.5) 40%, transparent 100%)",
    cloudsOverlay: null,
  },
];

export const DEFAULT_BACKGROUND_ID = "grass";

export function getBackground(id: string | null | undefined): BackgroundDef {
  if (!id) return BACKGROUNDS[0];
  return BACKGROUNDS.find((b) => b.id === id) ?? BACKGROUNDS[0];
}

// ---------- localStorage per-room persistence ----------

const STORAGE_PREFIX = "bg:";

export function loadStoredBackground(roomCode: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + roomCode);
  } catch {
    return null;
  }
}

export function storeBackground(roomCode: string, bgId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + roomCode, bgId);
  } catch {
    // Quota / private-mode — silently ignore; the field still syncs at
    // runtime, we just lose persistence across page reloads.
  }
}
