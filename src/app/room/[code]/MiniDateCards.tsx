"use client";

/**
 * Mini Date Cards — TICKET-2 (Week 1). Prompt-deck UI. The wire shape and
 * room-wide LWW state (`state.ts:currentCard`, `cardsEnabled`) were already
 * scaffolded in envelope.ts (`CardSchema`); this module only adds:
 *
 *   - `MiniDateCardsButton`  — the action-bar pill. Click proposes a random
 *     card if none is showing, or advances to a new random card if one is.
 *   - `MiniDateCardsModal`   — the centered card. Reads `roomState.currentCard`
 *     so it appears / advances on peers automatically.
 *
 * Card IDs are stable (see `date-cards.ts`) — the envelope carries only the
 * id, not the prompt text. Older/newer clients that don't recognise an id
 * render a graceful fallback and offer a "Next" instead of failing silently.
 * That keeps the deck editable without a coordinated release.
 *
 * `card.dismiss` is first-writer-wins on the reducer side; a race between
 * two clicks resolves cleanly.
 */

import { useCallback, useEffect } from "react";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import { getCardById, pickRandomCardId } from "@/lib/date-cards";
import { SparkleIcon } from "./icons";

export function MiniDateCardsButton() {
  const { roomState, sendEvent } = useRoomChannel();

  const propose = useCallback(() => {
    const nextId = pickRandomCardId(roomState.currentCard?.id ?? null);
    void sendEvent({ type: "card", phase: "propose", id: nextId });
  }, [roomState.currentCard, sendEvent]);

  return (
    <button
      type="button"
      onClick={propose}
      title="Draw a conversation prompt for both of you."
      className="flex h-[45px] items-center justify-center gap-2 rounded-lg border border-black/10 bg-white/60 px-6 font-[family-name:var(--font-outfit)] text-sm font-medium text-[#554100] shadow-sm backdrop-blur transition hover:bg-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
    >
      <SparkleIcon className="size-4 text-amber-600" />
      Mini Date Cards
    </button>
  );
}

/**
 * The floating card. Mounts inside `ShareStage` so it inherits the stage's
 * fullscreen context — a fullscreen viewer still sees the prompt.
 */
export function MiniDateCardsModal() {
  const { roomState, sendEvent } = useRoomChannel();
  const current = roomState.currentCard;

  const next = useCallback(() => {
    const nextId = pickRandomCardId(current?.id ?? null);
    void sendEvent({ type: "card", phase: "propose", id: nextId });
  }, [current, sendEvent]);

  const dismiss = useCallback(() => {
    if (!current) return;
    void sendEvent({ type: "card", phase: "dismiss", id: current.id });
  }, [current, sendEvent]);

  // Esc to close — mirrors typical modal affordance without a focus trap
  // (small, non-blocking UI; we don't need to steal focus from chat/video).
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [current, dismiss]);

  if (!current) return null;

  const card = getCardById(current.id);
  const prompt = card?.prompt ?? "A card arrived that this version doesn't know yet.";
  const category = card?.category ?? "light";

  return (
    <div
      role="dialog"
      aria-label="Conversation prompt"
      className="pointer-events-auto absolute left-1/2 top-1/2 z-40 w-[min(88vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white bg-white/90 p-5 shadow-2xl backdrop-blur"
    >
      <div className="mb-3 flex items-center justify-between">
        <span
          className={
            "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[1.5px] " +
            categoryBadgeClass(category)
          }
        >
          {category}
        </span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close prompt"
          className="rounded-md p-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <span aria-hidden className="text-lg leading-none">
            ×
          </span>
        </button>
      </div>
      <p className="font-[family-name:var(--font-outfit)] text-lg leading-snug text-zinc-900">
        {prompt}
      </p>
      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={dismiss}
          className="rounded-lg border border-black/10 bg-white px-3 py-2 font-[family-name:var(--font-outfit)] text-sm text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          Close
        </button>
        <button
          type="button"
          onClick={next}
          className="rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 font-[family-name:var(--font-outfit)] text-sm font-medium text-amber-900 transition hover:bg-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          Next prompt
        </button>
      </div>
    </div>
  );
}

function categoryBadgeClass(category: string): string {
  switch (category) {
    case "deep":
      return "bg-indigo-100 text-indigo-800";
    case "silly":
      return "bg-emerald-100 text-emerald-800";
    case "spicy":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-amber-100 text-amber-800";
  }
}
