"use client";

/**
 * Wait for Me (Phase-2 feature 1). ADR 0005 §2 (state), PM AC1.x.
 *
 * Two surfaces exported here:
 *
 *  - `WaitForMePill`  — the action-bar button, three visual states:
 *      1. `Wait for Me`             — no hold, anyone can click
 *      2. `Resume`                  — initiator only, releases the hold
 *      3. `Held by <name>`          — non-initiators, disabled
 *
 *  - `HoldBanner`     — a stage overlay identifying the initiator (AC1.4).
 *
 * How it "effectively stops the movie" (AC1.1):
 *  - We can't reach into the shared tab's `<video>` (cross-origin), and the
 *    ADR explicitly rules out driving the underlying player. So the "stop"
 *    is a two-part social/technical contract:
 *    1. The sharer sees the banner and voluntarily pauses their tab.
 *    2. On the guest side we pause the LiveKit-attached `<video>` element
 *       (in `ScreenShareView`, driven by `roomState.held`). Guests see a
 *       frozen frame regardless of what the sharer does.
 *
 *  This file owns (1). `ScreenShareView` handles (2) — the roomState is
 *  read there and applied to the video element.
 *
 * AC1.3 (auto-release when initiator disconnects) is derived in the room
 * channel reducer via `releaseHoldOnDisconnect` — nothing to do here.
 *
 * AC1.5 debounce: `sendEvent` applies the outbound event to local state
 * synchronously via the reducer, so a rapid second click flips the button
 * to `Resume` before the second event can fire against a stale label. No
 * explicit timer needed.
 */

import { useRoomChannel } from "@/lib/room/use-room-channel";

interface WaitForMePillProps {
  /** Local participant's display name — carried in the hold payload so
   *  peers can render "Held by <name>" without a directory lookup. */
  nickname: string;
  /** Local participant's identity. Used to decide which button state to
   *  render (initiator sees Resume; others see the disabled label). */
  localIdentity: string;
}

export function WaitForMePill({ nickname, localIdentity }: WaitForMePillProps) {
  const { roomState, sendEvent } = useRoomChannel();
  const held = roomState.held;
  const heldByMe = held !== null && held.by === localIdentity;
  const heldByOther = held !== null && held.by !== localIdentity;

  const onClick = () => {
    if (heldByOther) return; // AC1.5 — disabled for non-initiators
    if (heldByMe) {
      void sendEvent({ type: "hold", held: false });
      return;
    }
    void sendEvent({ type: "hold", held: true, by: localIdentity, byName: nickname });
  };

  const label = heldByOther
    ? `Held by ${held?.byName ?? "someone"}`
    : heldByMe
      ? "Resume"
      : "Wait for Me";

  // Same visual family as `FeaturePill` (see RoomClient.tsx), with three
  // state variants: neutral, primary (Resume), disabled (Held by …).
  const base =
    "flex h-[45px] items-center justify-center gap-2 rounded-lg border px-6 font-[family-name:var(--font-outfit)] text-sm font-medium backdrop-blur transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500";
  const variant = heldByOther
    ? "border-amber-300 bg-amber-50/80 text-amber-900 disabled:cursor-not-allowed"
    : heldByMe
      ? "border-emerald-300 bg-emerald-50/90 text-emerald-900 hover:bg-emerald-100"
      : "border-black/10 bg-white/60 text-zinc-900 hover:bg-white/80";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={heldByOther}
      aria-disabled={heldByOther}
      aria-pressed={heldByMe}
      className={`${base} ${variant}`}
    >
      {label}
    </button>
  );
}

// ---- Stage banner --------------------------------------------------------

/**
 * AC1.4 banner. Renders inside `ShareStage`'s stacking context; hidden when
 * there is no hold. Announced via `role="status"` so screen readers pick up
 * the hold on every state transition.
 */
export function HoldBanner() {
  const { roomState } = useRoomChannel();
  const held = roomState.held;
  if (held === null) return null;
  const name = held.byName ?? "Someone";
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center"
    >
      <div className="rounded-lg border border-amber-300 bg-amber-50/95 px-4 py-2 shadow-md backdrop-blur">
        <span className="font-[family-name:var(--font-outfit)] text-sm font-medium text-amber-900">
          Held by {name}
        </span>
      </div>
    </div>
  );
}
