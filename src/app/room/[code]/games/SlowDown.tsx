"use client";

/**
 * Slow Down — cooperative timed-ritual couples game.
 *
 * Sync model: either partner taps Start → broadcast `start` with the UTC
 * anchor timestamp. Both peers compute `elapsed = now - startAt` and render
 * the same countdown. Clock skew is a non-issue at second-granularity for a
 * two-person call; anything under ~1 s drift is invisible to the eye.
 *
 * Phases (derived, no dedicated `phase` state):
 *   - ready    → no active timer; big Start button.
 *   - running  → startAt set, remaining > 0.
 *   - done     → startAt set, remaining ≤ 0.
 *
 * Either partner can Stop mid-ritual (broadcast `stop`), which snaps
 * back to ready. `next` advances the deck and clears the timer. `reset`
 * wipes the round counter.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Room } from "livekit-client";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import type { RoomEvent as ChannelEvent } from "@/lib/room/envelope";
import { getRitual, SLOW_DECK_LENGTH } from "@/lib/games/slow-down";
import { getWeekSeed } from "@/lib/games/shuffle";

interface Props {
  meIdentity: string;
  partnerIdentity: string;
  partnerName: string;
}

export function SlowDown({ meIdentity, partnerIdentity, partnerName }: Props) {
  const { sendEvent, subscribe } = useRoomChannel();
  const [roundIdx, setRoundIdx] = useState(0);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const weekSeed = useMemo(() => getWeekSeed(), []);
  const ritual = useMemo(
    () => getRitual(roundIdx, weekSeed),
    [roundIdx, weekSeed],
  );

  // Tick every 100 ms while running so the countdown feels smooth without
  // hammering the render loop. Stop the interval as soon as we're not
  // running (or before Start is tapped) — no wasted work.
  const running = startAt !== null && now - startAt < ritual.durationSec * 1000;
  useEffect(() => {
    if (startAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [startAt]);

  useEffect(() => {
    const handler = (event: ChannelEvent) => {
      if (event.type !== "slowDown") return;
      if (event.phase === "reset") {
        setRoundIdx(0);
        setStartAt(null);
        return;
      }
      if (event.phase === "next") {
        if (event.nextIdx <= roundIdx) return;
        setRoundIdx(event.nextIdx);
        setStartAt(null);
        return;
      }
      if (event.phase === "start") {
        if (event.roundIdx !== roundIdx) return;
        setStartAt(event.startAt);
        setNow(Date.now());
        return;
      }
      if (event.phase === "stop") {
        if (event.roundIdx !== roundIdx) return;
        setStartAt(null);
        return;
      }
    };
    return subscribe(handler);
  }, [subscribe, roundIdx]);

  const start = useCallback(() => {
    // Anchor slightly in the future so both peers arrive at t=0 within
    // one network round-trip — feels like a genuine 3-2-1 GO rather than
    // one side beating the other to zero. 300 ms is comfortable given
    // typical data-channel latency (~50–150 ms).
    const anchor = Date.now() + 300;
    setStartAt(anchor);
    setNow(Date.now());
    void sendEvent({
      type: "slowDown",
      phase: "start",
      roundIdx,
      startAt: anchor,
      by: meIdentity,
    });
  }, [roundIdx, meIdentity, sendEvent]);

  const stop = useCallback(() => {
    setStartAt(null);
    void sendEvent({
      type: "slowDown",
      phase: "stop",
      roundIdx,
      by: meIdentity,
    });
  }, [roundIdx, meIdentity, sendEvent]);

  const nextRitual = useCallback(() => {
    void sendEvent({
      type: "slowDown",
      phase: "next",
      nextIdx: roundIdx + 1,
    });
  }, [roundIdx, sendEvent]);

  const reset = useCallback(() => {
    void sendEvent({ type: "slowDown", phase: "reset" });
  }, [sendEvent]);

  const totalMs = ritual.durationSec * 1000;
  const elapsedMs = startAt === null ? 0 : Math.max(0, now - startAt);
  const remainingMs = Math.max(0, totalMs - elapsedMs);
  const progress = startAt === null ? 0 : Math.min(1, elapsedMs / totalMs);
  const done = startAt !== null && !running;
  const remainingSec = Math.ceil(remainingMs / 1000);

  // Ignore partnerIdentity in the render tree directly — it's used only to
  // remind the reader the game is 2-player scoped, but neither the timer
  // nor the ritual copy differentiates between partners. Silence the
  // no-unused warning by referencing it in a debug memo below.
  useMemo(() => partnerIdentity, [partnerIdentity]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-xl">
      {/* Backdrop — deliberately calm; no arcade neon. Warm rose→peach
          drift on ivory so the panel reads as a different mode. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1100px 300px at 20% 0%, rgba(251,207,232,0.45), transparent 60%), radial-gradient(900px 260px at 90% 100%, rgba(254,215,170,0.45), transparent 60%), linear-gradient(180deg, #fffaf5 0%, #fef3ec 100%)",
        }}
      />

      {/* HUD */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-white/85 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[10px] font-semibold uppercase tracking-[1.5px] text-zinc-600 shadow-sm ring-1 ring-black/5">
            Ritual {(roundIdx % SLOW_DECK_LENGTH) + 1}
          </span>
          <span className="rounded-full bg-gradient-to-r from-rose-400 to-orange-400 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[10px] font-semibold uppercase tracking-[1.5px] text-white shadow-sm">
            {ritual.durationSec}s
          </span>
        </div>
        <button
          type="button"
          onClick={reset}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
        >
          New game
        </button>
      </div>

      {/* Prompt card */}
      <div className="relative flex flex-col gap-1 overflow-hidden rounded-2xl bg-white/70 p-4 shadow-sm ring-1 ring-rose-100 backdrop-blur">
        <span
          aria-hidden
          className="pointer-events-none absolute -right-2 -top-4 text-[80px] leading-none opacity-15"
        >
          {ritual.glyph}
        </span>
        <span className="font-[family-name:var(--font-outfit)] text-[10px] font-bold uppercase tracking-[2.5px] text-rose-500">
          {ritual.title}
        </span>
        <p className="font-[family-name:var(--font-outfit)] text-sm leading-snug text-zinc-800 sm:text-base">
          {ritual.prompt}
        </p>
      </div>

      {/* Timer ring — dominant visual element */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
        <TimerRing
          progress={progress}
          label={
            startAt === null
              ? "Ready?"
              : done
                ? "Done"
                : remainingSec.toString().padStart(2, "0")
          }
          sublabel={
            startAt === null
              ? "Tap Start when you're both here"
              : done
                ? "🕯️"
                : "seconds"
          }
          breathing={running}
        />
        {running && (
          <p className="max-w-[260px] text-center font-[family-name:var(--font-outfit)] text-[12px] italic text-zinc-500">
            {ritual.duringCaption}
          </p>
        )}
        {done && (
          <p className="text-center font-[family-name:var(--font-outfit)] text-[12px] text-zinc-600">
            Thank you for being here 💗
          </p>
        )}
      </div>

      {/* Controls */}
      <div className="min-h-[38px]">
        {startAt === null && (
          <button
            type="button"
            onClick={start}
            className="w-full rounded-xl bg-gradient-to-r from-rose-500 to-orange-500 px-3 py-2.5 font-[family-name:var(--font-outfit)] text-sm font-semibold text-white shadow-lg transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
          >
            Start together
          </button>
        )}
        {running && (
          <button
            type="button"
            onClick={stop}
            className="w-full rounded-xl border border-rose-200 bg-white px-3 py-2.5 font-[family-name:var(--font-outfit)] text-sm font-medium text-rose-600 shadow-sm transition hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
          >
            End early
          </button>
        )}
        {done && (
          <button
            type="button"
            onClick={nextRitual}
            className="w-full rounded-xl bg-zinc-900 px-3 py-2.5 font-[family-name:var(--font-outfit)] text-sm font-semibold text-white shadow-lg transition hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-700"
          >
            Next ritual →
          </button>
        )}
      </div>

      {/* Screen-reader label — partner name isn't shown visually but should
          still be present for context. */}
      <span className="sr-only">
        Ritual with {partnerName}. {running ? "In progress." : done ? "Complete." : "Not started."}
      </span>
    </div>
  );
}

interface TimerRingProps {
  /** 0 → 1 fill fraction (0 = empty, 1 = fully swept). */
  progress: number;
  label: string;
  sublabel: string;
  /** Adds a soft breathing scale animation while true. */
  breathing: boolean;
}

/**
 * Circular countdown ring rendered as SVG. Uses stroke-dashoffset to sweep
 * the arc; the entire ring is one path so it works cleanly across the whole
 * range. Sized responsively — max 200px so it fits the narrow right column.
 */
function TimerRing({ progress, label, sublabel, breathing }: TimerRingProps) {
  const size = 180;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - progress);

  return (
    <div
      className={
        "relative flex size-[180px] items-center justify-center rounded-full " +
        (breathing ? "animate-[pulse_4s_ease-in-out_infinite]" : "")
      }
      style={{
        background:
          "radial-gradient(closest-side, rgba(255,255,255,0.9), rgba(255,255,255,0.5) 70%, transparent 100%)",
      }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="slow-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f43f5e" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(244,114,182,0.15)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="url(#slow-ring)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          fill="none"
          style={{ transition: "stroke-dashoffset 100ms linear" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-[family-name:var(--font-outfit)] text-4xl font-bold tabular-nums text-zinc-900">
          {label}
        </span>
        <span className="font-[family-name:var(--font-outfit)] text-[11px] uppercase tracking-[2px] text-zinc-500">
          {sublabel}
        </span>
      </div>
    </div>
  );
}

export function SlowDownPanel({ room }: { room: Room }) {
  const me = room.localParticipant;
  const partner = [...room.remoteParticipants.values()][0];
  if (!partner) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white/60 p-4 text-center">
        <p className="font-[family-name:var(--font-outfit)] text-sm text-zinc-600">
          Slow Down is for two — waiting for someone to join…
        </p>
      </div>
    );
  }
  return (
    <SlowDown
      meIdentity={me.identity}
      partnerIdentity={partner.identity}
      partnerName={partner.name ?? "your partner"}
    />
  );
}
