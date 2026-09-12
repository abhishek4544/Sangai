"use client";

/**
 * Story Time — cooperative co-authoring couples game.
 *
 * Turn model: 4 blanks per story, alternating between partners (A/B/A/B).
 * Which sorted-identity slot goes first per story rotates with `roundIdx`
 * so nobody's stuck as "first" for the whole session.
 *
 * Presentation: the story renders live at the top with `___` for empty
 * blanks and the couple's picks highlighted. The bottom half shows the
 * option grid for whoever's turn it currently is — the other partner sees
 * "waiting" and can watch the story fill in.
 *
 * All picks flow through the shared event stream, so both peers reach the
 * same complete story deterministically.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Room } from "livekit-client";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import type { RoomEvent as ChannelEvent } from "@/lib/room/envelope";
import {
  getStoryCard,
  renderStory,
  STORY_DECK_LENGTH,
} from "@/lib/games/story-time";
import { getWeekSeed } from "@/lib/games/shuffle";

interface Props {
  meIdentity: string;
  partnerIdentity: string;
  myName: string;
  partnerName: string;
}

/** Which identity fills blank `blankIdx` on a given story round.
 *  Blanks alternate A/B/A/B, and the "A" slot itself alternates by round
 *  so neither partner is always first. */
function fillerFor(
  blankIdx: number,
  roundIdx: number,
  orderedIds: readonly [string, string],
): string {
  const firstSlot = roundIdx % 2; // 0 or 1
  const slot = (firstSlot + blankIdx) % 2;
  return orderedIds[slot];
}

export function StoryTime({
  meIdentity,
  partnerIdentity,
  myName,
  partnerName,
}: Props) {
  const { sendEvent, subscribe } = useRoomChannel();
  const [roundIdx, setRoundIdx] = useState(0);
  const [picks, setPicks] = useState<(number | null)[]>([null, null, null, null]);

  const orderedIds = useMemo(
    () => [meIdentity, partnerIdentity].sort() as [string, string],
    [meIdentity, partnerIdentity],
  );

  const weekSeed = useMemo(() => getWeekSeed(), []);
  const card = useMemo(
    () => getStoryCard(roundIdx, weekSeed),
    [roundIdx, weekSeed],
  );

  // First empty blank == current turn's blank.
  const currentBlankIdx = picks.findIndex((p) => p === null);
  const complete = currentBlankIdx === -1;
  const currentFiller = complete
    ? null
    : fillerFor(currentBlankIdx, roundIdx, orderedIds);
  const isMyTurn = !complete && currentFiller === meIdentity;
  const currentBlank = complete ? null : card.blanks[currentBlankIdx];

  useEffect(() => {
    const handler = (event: ChannelEvent) => {
      if (event.type !== "storyTime") return;
      if (event.phase === "reset") {
        setRoundIdx(0);
        setPicks([null, null, null, null]);
        return;
      }
      if (event.phase === "next") {
        if (event.nextIdx <= roundIdx) return;
        setRoundIdx(event.nextIdx);
        setPicks([null, null, null, null]);
        return;
      }
      if (event.phase === "fill") {
        if (event.roundIdx !== roundIdx) return;
        const expectedFiller = fillerFor(event.blankIdx, roundIdx, orderedIds);
        if (event.by !== expectedFiller) return; // off-turn sender ignored
        setPicks((prev) => {
          if (prev[event.blankIdx] !== null) return prev; // don't overwrite
          const next = prev.slice();
          next[event.blankIdx] = event.optionIdx;
          return next;
        });
        return;
      }
    };
    return subscribe(handler);
  }, [subscribe, roundIdx, orderedIds]);

  const fill = useCallback(
    (optionIdx: number) => {
      if (!isMyTurn || currentBlankIdx === -1) return;
      // Optimistic — echo is a no-op via the "already filled" guard above.
      setPicks((prev) => {
        const next = prev.slice();
        next[currentBlankIdx] = optionIdx;
        return next;
      });
      void sendEvent({
        type: "storyTime",
        phase: "fill",
        roundIdx,
        blankIdx: currentBlankIdx,
        optionIdx,
        by: meIdentity,
      });
    },
    [isMyTurn, currentBlankIdx, roundIdx, meIdentity, sendEvent],
  );

  const nextStory = useCallback(() => {
    void sendEvent({
      type: "storyTime",
      phase: "next",
      nextIdx: roundIdx + 1,
    });
  }, [roundIdx, sendEvent]);

  const reset = useCallback(() => {
    void sendEvent({ type: "storyTime", phase: "reset" });
  }, [sendEvent]);

  const segments = renderStory(card, picks);
  const storyNumber = (roundIdx % STORY_DECK_LENGTH) + 1;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-xl">
      {/* Backdrop — parchment / storybook warm glow. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1100px 260px at 90% 0%, rgba(251,146,60,0.20), transparent 60%), radial-gradient(900px 260px at 10% 100%, rgba(217,70,239,0.18), transparent 60%), linear-gradient(180deg, #fff7ed 0%, #fef3c7 100%)",
        }}
      />

      {/* HUD */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-white/85 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[10px] font-semibold uppercase tracking-[1.5px] text-zinc-600 shadow-sm ring-1 ring-black/5">
            Story {storyNumber}
          </span>
          <span className="rounded-full bg-gradient-to-r from-orange-500 to-pink-500 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[10px] font-semibold uppercase tracking-[1.5px] text-white shadow-sm">
            {picks.filter((p) => p !== null).length}/4 written
          </span>
        </div>
        <button
          type="button"
          onClick={reset}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
        >
          New game
        </button>
      </div>

      {/* Story parchment */}
      <div
        className="relative flex min-h-[130px] flex-col justify-center overflow-hidden rounded-2xl bg-white p-4 shadow-xl ring-1 ring-orange-200"
        style={{
          background:
            "linear-gradient(180deg, #fffbf4 0%, #fef3c7 100%)",
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -right-2 -top-3 text-[80px] leading-none opacity-15"
        >
          {card.flavor ?? "📖"}
        </span>
        <p className="relative z-10 font-[family-name:var(--font-outfit)] text-[15px] leading-relaxed text-zinc-800 sm:text-base">
          {segments.map((s, i) =>
            s.kind === "text" ? (
              <span key={i}>{s.value}</span>
            ) : s.value === "___" ? (
              <span
                key={i}
                className={
                  "mx-0.5 inline-block min-w-[46px] rounded-md border-b-2 border-dashed px-1 text-center align-middle font-semibold " +
                  (s.blankIdx === currentBlankIdx
                    ? "border-fuchsia-500 bg-fuchsia-50 text-fuchsia-600 animate-pulse"
                    : "border-zinc-300 text-zinc-400")
                }
              >
                ___
              </span>
            ) : (
              <span
                key={i}
                className="mx-0.5 inline-block rounded-md bg-gradient-to-r from-orange-500 to-pink-500 px-1.5 py-[1px] align-middle font-bold text-white shadow-sm"
              >
                {s.value}
              </span>
            ),
          )}
        </p>
      </div>

      {/* Interaction zone — option grid on turn, waiting message otherwise, or completion */}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {complete ? (
          <CompletionPanel onNext={nextStory} />
        ) : isMyTurn ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <p className="text-center font-[family-name:var(--font-outfit)] text-[10px] font-bold uppercase tracking-[2px] text-zinc-500">
              Your turn — pick {currentBlank!.label}
            </p>
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
              {currentBlank!.options.map((opt, i) => (
                <OptionButton
                  key={i}
                  index={i}
                  label={opt}
                  onClick={() => fill(i)}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-orange-200 bg-white/50 p-4 text-center">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-orange-400 opacity-70" />
                <span className="relative inline-flex size-2 rounded-full bg-orange-500" />
              </span>
              <p className="font-[family-name:var(--font-outfit)] text-sm font-medium text-zinc-700">
                {partnerName} is writing…
              </p>
            </div>
            <p className="font-[family-name:var(--font-outfit)] text-[11px] text-zinc-500">
              They&apos;re picking {currentBlank!.label}
            </p>
          </div>
        )}
      </div>

      {/* Byline shown once story is complete but before Next */}
      {complete && (
        <p className="text-center font-[family-name:var(--font-outfit)] text-[10px] uppercase tracking-[2px] text-zinc-500">
          By {myName} &amp; {partnerName}
        </p>
      )}
    </div>
  );
}

function OptionButton({
  index,
  label,
  onClick,
}: {
  index: number;
  label: string;
  onClick: () => void;
}) {
  const palettes = [
    { bg: "linear-gradient(135deg, #f97316 0%, #ec4899 100%)", glow: "rgba(249,115,22,0.5)" },
    { bg: "linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)", glow: "rgba(139,92,246,0.5)" },
    { bg: "linear-gradient(135deg, #10b981 0%, #06b6d4 100%)", glow: "rgba(16,185,129,0.5)" },
    { bg: "linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)", glow: "rgba(239,68,68,0.5)" },
  ];
  const palette = palettes[index];
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl px-3 py-3 text-center transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus-visible:ring-4 focus-visible:ring-white/70"
      style={{
        background: palette.bg,
        boxShadow: `0 16px 30px -12px ${palette.glow}`,
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(400px 100px at 50% -20%, rgba(255,255,255,0.35), transparent 60%)",
        }}
      />
      <span className="relative z-10 font-[family-name:var(--font-outfit)] text-sm font-bold text-white drop-shadow-sm sm:text-base">
        {label}
      </span>
    </button>
  );
}

function CompletionPanel({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-orange-100 to-pink-100 p-4 text-center ring-1 ring-orange-200">
      <span className="rounded-full bg-gradient-to-r from-orange-500 to-pink-500 px-3 py-0.5 font-[family-name:var(--font-outfit)] text-[11px] font-bold uppercase tracking-[1.5px] text-white shadow-md">
        Masterpiece complete ✨
      </span>
      <p className="font-[family-name:var(--font-outfit)] text-[11px] text-zinc-600">
        Read it back to each other, then write another.
      </p>
      <button
        type="button"
        onClick={onNext}
        className="mt-1 w-full rounded-xl bg-zinc-900 px-3 py-2 font-[family-name:var(--font-outfit)] text-sm font-semibold text-white shadow-lg transition hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-700"
      >
        Next story →
      </button>
    </div>
  );
}

export function StoryTimePanel({ room }: { room: Room }) {
  const me = room.localParticipant;
  const partner = [...room.remoteParticipants.values()][0];
  if (!partner) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white/60 p-4 text-center">
        <p className="font-[family-name:var(--font-outfit)] text-sm text-zinc-600">
          Story Time needs two players. Waiting for someone to join…
        </p>
      </div>
    );
  }
  return (
    <StoryTime
      meIdentity={me.identity}
      partnerIdentity={partner.identity}
      myName={me.name ?? "You"}
      partnerName={partner.name ?? "your partner"}
    />
  );
}
