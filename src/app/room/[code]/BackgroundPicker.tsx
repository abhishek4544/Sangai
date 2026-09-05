"use client";

/**
 * BackgroundPicker — TICKET-3. Dropdown of cinema scenes; selection publishes
 * `background.pick` on the LiveKit data channel so both participants swap in
 * sync. LWW is enforced by the reducer (`state.ts`) — the sender's local
 * `sendEvent` also applies immediately for zero-latency preview.
 */

import { useEffect, useRef, useState } from "react";
import { BACKGROUNDS } from "@/lib/backgrounds";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import { PaletteIcon } from "./icons";

export function BackgroundPicker({ currentId }: { currentId: string }) {
  const { sendEvent } = useRoomChannel();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on outside-click / Esc. Menu is small — we don't need FocusTrap.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (id: string) => {
    setOpen(false);
    if (id === currentId) return;
    void sendEvent({ type: "background", phase: "pick", id });
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change background"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg bg-black/40 px-3 py-2 text-zinc-100 backdrop-blur transition hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <PaletteIcon className="size-4" />
        <span className="font-[family-name:var(--font-outfit)] text-xs tracking-[0.5px]">
          Scene
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-lg border border-white bg-white/95 shadow-xl backdrop-blur"
        >
          {BACKGROUNDS.map((bg) => {
            const active = bg.id === currentId;
            return (
              <button
                key={bg.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => pick(bg.id)}
                className={
                  "flex w-full items-center gap-3 px-3 py-2 text-left font-[family-name:var(--font-outfit)] text-sm text-zinc-900 transition hover:bg-sky-50 focus:outline-none focus-visible:bg-sky-50 " +
                  (active ? "bg-sky-100/70" : "")
                }
              >
                <span aria-hidden className="text-lg leading-none">
                  {bg.glyph}
                </span>
                <span className="flex-1">{bg.label}</span>
                {active && (
                  <span aria-hidden className="text-xs text-sky-700">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
