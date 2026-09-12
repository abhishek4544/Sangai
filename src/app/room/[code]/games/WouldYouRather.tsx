"use client";

/**
 * Would You Rather — arcade-styled couples pick game.
 *
 * Sync model: no roomState field. Each peer derives round state from the
 * ordered event stream. `roundIdx` bumps forward-only; stale `pick` events
 * for older rounds are dropped. Match-streak / total score are tallied locally
 * from the same event stream so both peers reach identical numbers without
 * a separate scoreboard broadcast.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Room } from "livekit-client";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import type { RoomEvent as ChannelEvent } from "@/lib/room/envelope";
import { getWYRPrompt, WYR_DECK_LENGTH } from "@/lib/games/would-you-rather";
import { getWeekSeed } from "@/lib/games/shuffle";

type Option = "a" | "b";

interface Props {
  meIdentity: string;
  partnerIdentity: string;
  partnerName: string;
}

interface RoundPicks {
  me: Option | null;
  partner: Option | null;
}

export function WouldYouRather({ meIdentity, partnerIdentity, partnerName }: Props) {
  const { sendEvent, subscribe } = useRoomChannel();
  const [roundIdx, setRoundIdx] = useState(0);
  const [picks, setPicks] = useState<RoundPicks>({ me: null, partner: null });
  const [score, setScore] = useState({ matches: 0, played: 0 });
  // Counted-rounds guard — a round only ticks the score once, even if events
  // arrive out-of-order or the effect re-runs.
  const countedRoundsRef = useRef<Set<number>>(new Set());
  // Purely-visual reveal pulse — flips true on the frame both picks land so
  // the reveal panel can animate in, then latches for the round.
  const [revealed, setRevealed] = useState(false);

  // Week seed is stable for the life of the mount — both peers on the same
  // UTC week compute the same value with no over-the-wire coordination.
  const weekSeed = useMemo(() => getWeekSeed(), []);
  const prompt = useMemo(
    () => getWYRPrompt(roundIdx, weekSeed),
    [roundIdx, weekSeed],
  );
  const bothIn = picks.me !== null && picks.partner !== null;
  const isMatch = bothIn && picks.me === picks.partner;

  useEffect(() => {
    if (bothIn && !countedRoundsRef.current.has(roundIdx)) {
      countedRoundsRef.current.add(roundIdx);
      setScore((s) => ({
        matches: s.matches + (picks.me === picks.partner ? 1 : 0),
        played: s.played + 1,
      }));
      setRevealed(true);
    }
  }, [bothIn, roundIdx, picks.me, picks.partner]);

  useEffect(() => {
    const handler = (event: ChannelEvent) => {
      if (event.type !== "wouldYouRather") return;
      if (event.phase === "reset") {
        setRoundIdx(0);
        setPicks({ me: null, partner: null });
        setScore({ matches: 0, played: 0 });
        countedRoundsRef.current = new Set();
        setRevealed(false);
        return;
      }
      if (event.phase === "next") {
        if (event.nextIdx <= roundIdx) return;
        setRoundIdx(event.nextIdx);
        setPicks({ me: null, partner: null });
        setRevealed(false);
        return;
      }
      if (event.phase === "pick") {
        if (event.roundIdx !== roundIdx) return;
        setPicks((prev) => {
          if (event.by === meIdentity) return { ...prev, me: event.option };
          if (event.by === partnerIdentity) return { ...prev, partner: event.option };
          return prev;
        });
        return;
      }
    };
    return subscribe(handler);
  }, [subscribe, roundIdx, meIdentity, partnerIdentity]);

  const pick = useCallback(
    (option: Option) => {
      if (picks.me !== null) return;
      // Optimistic local update — feels snappy; the echoed event is a no-op
      // once picks.me is already set (guard above).
      setPicks((prev) => ({ ...prev, me: option }));
      void sendEvent({
        type: "wouldYouRather",
        phase: "pick",
        roundIdx,
        option,
        by: meIdentity,
      });
    },
    [picks.me, roundIdx, meIdentity, sendEvent],
  );

  const nextRound = useCallback(() => {
    const next = roundIdx + 1;
    void sendEvent({ type: "wouldYouRather", phase: "next", nextIdx: next });
  }, [roundIdx, sendEvent]);

  const reset = useCallback(() => {
    void sendEvent({ type: "wouldYouRather", phase: "reset" });
  }, [sendEvent]);

  const roundNumber = (roundIdx % WYR_DECK_LENGTH) + 1;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-xl">
      {/* Animated backdrop — subtle drifting gradient. Sits behind cards. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-90"
        style={{
          background:
            "radial-gradient(1200px 300px at 10% 0%, rgba(244,114,182,0.18), transparent 60%), radial-gradient(900px 260px at 90% 100%, rgba(56,189,248,0.22), transparent 60%), linear-gradient(180deg, #fff 0%, #f8fafc 100%)",
        }}
      />

      {/* HUD row */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-white/80 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[10px] font-semibold uppercase tracking-[1.5px] text-zinc-600 shadow-sm ring-1 ring-black/5">
            Round {roundNumber}
          </span>
          <span className="rounded-full bg-gradient-to-r from-fuchsia-500 to-rose-500 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[10px] font-semibold uppercase tracking-[1.5px] text-white shadow-sm">
            {score.matches}/{score.played} in sync
          </span>
        </div>
        <button
          type="button"
          onClick={reset}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          New game
        </button>
      </div>

      {/* Cards */}
      <div className="relative flex min-h-0 flex-1 flex-col gap-2">
        <ChoiceCard
          side="a"
          label={prompt.a}
          disabled={picks.me !== null}
          selectedByMe={picks.me === "a"}
          selectedByPartner={picks.partner === "a"}
          revealed={revealed}
          isMatch={isMatch && picks.me === "a"}
          onClick={() => pick("a")}
        />
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          <div className="flex size-11 items-center justify-center rounded-full bg-white text-[11px] font-black uppercase tracking-[2px] text-zinc-800 shadow-lg ring-2 ring-white">
            <span aria-hidden className="-mt-0.5">
              {prompt.flavor ?? "or"}
            </span>
          </div>
        </div>
        <ChoiceCard
          side="b"
          label={prompt.b}
          disabled={picks.me !== null}
          selectedByMe={picks.me === "b"}
          selectedByPartner={picks.partner === "b"}
          revealed={revealed}
          isMatch={isMatch && picks.me === "b"}
          onClick={() => pick("b")}
        />
      </div>

      {/* Footer: status / next-round CTA */}
      <div className="min-h-[38px]">
        {!bothIn && picks.me === null && (
          <p className="text-center font-[family-name:var(--font-outfit)] text-[12px] text-zinc-500">
            Tap the one you&apos;d rather.
          </p>
        )}
        {!bothIn && picks.me !== null && (
          <div className="flex items-center justify-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-fuchsia-400 opacity-70" />
              <span className="relative inline-flex size-2 rounded-full bg-fuchsia-500" />
            </span>
            <p className="font-[family-name:var(--font-outfit)] text-[12px] text-zinc-600">
              Waiting for {partnerName}…
            </p>
          </div>
        )}
        {bothIn && (
          <div className="flex flex-col items-center gap-1.5">
            <span
              className={
                "rounded-full px-3 py-0.5 font-[family-name:var(--font-outfit)] text-[11px] font-bold uppercase tracking-[1.5px] " +
                (isMatch
                  ? "bg-gradient-to-r from-emerald-400 to-teal-500 text-white shadow-md"
                  : "bg-gradient-to-r from-amber-300 to-orange-400 text-white shadow-md")
              }
            >
              {isMatch ? "In sync ✨" : "Split vote 🔀"}
            </span>
            <button
              type="button"
              onClick={nextRound}
              className="w-full rounded-xl bg-zinc-900 px-3 py-2 font-[family-name:var(--font-outfit)] text-sm font-semibold text-white shadow-lg transition hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-700"
            >
              Next round →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface ChoiceCardProps {
  side: Option;
  label: string;
  disabled: boolean;
  selectedByMe: boolean;
  selectedByPartner: boolean;
  revealed: boolean;
  isMatch: boolean;
  onClick: () => void;
}

function ChoiceCard({
  side,
  label,
  disabled,
  selectedByMe,
  selectedByPartner,
  revealed,
  isMatch,
  onClick,
}: ChoiceCardProps) {
  // Two visual identities, one per side. Chosen to be high-contrast against
  // each other and readable at any small size — the card is the game's face.
  const palette =
    side === "a"
      ? {
          bg: "linear-gradient(135deg, #ec4899 0%, #f97316 100%)",
          glow: "0 20px 40px -12px rgba(236, 72, 153, 0.55)",
          matchRing: "ring-fuchsia-300",
          letter: "A",
        }
      : {
          bg: "linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)",
          glow: "0 20px 40px -12px rgba(99, 102, 241, 0.55)",
          matchRing: "ring-cyan-300",
          letter: "B",
        };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "group relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl px-4 py-5 text-left transition-all duration-200 focus:outline-none focus-visible:ring-4 " +
        (disabled ? "cursor-default" : "hover:scale-[1.015] active:scale-[0.99]") +
        " " +
        palette.matchRing +
        (selectedByMe || selectedByPartner ? " ring-4 ring-white/90" : "")
      }
      style={{
        background: palette.bg,
        boxShadow: palette.glow,
      }}
    >
      {/* Big translucent letter watermark */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-4 -top-6 font-[family-name:var(--font-outfit)] text-[120px] font-black leading-none text-white/15"
      >
        {palette.letter}
      </span>

      {/* Grain / shimmer overlay on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(600px 120px at 50% -20%, rgba(255,255,255,0.35), transparent 60%)",
        }}
      />

      {/* Match burst — a soft radial pulse when this side is the mutual pick */}
      {isMatch && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-pulse"
          style={{
            background:
              "radial-gradient(400px 200px at 50% 50%, rgba(255,255,255,0.35), transparent 70%)",
          }}
        />
      )}

      <div className="relative z-10 flex w-full items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/25 font-[family-name:var(--font-outfit)] text-lg font-black text-white backdrop-blur">
          {palette.letter}
        </span>
        <span className="font-[family-name:var(--font-outfit)] text-base font-semibold leading-tight text-white drop-shadow-sm sm:text-lg">
          {label}
        </span>
      </div>

      {/* Reveal badges — show which peer picked this card once both are in */}
      {revealed && (
        <div className="absolute bottom-2 right-2 z-10 flex gap-1">
          {selectedByMe && (
            <span className="rounded-full bg-white/90 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[10px] font-bold uppercase tracking-[1px] text-zinc-800 shadow">
              You
            </span>
          )}
          {selectedByPartner && (
            <span className="rounded-full bg-black/70 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[10px] font-bold uppercase tracking-[1px] text-white shadow">
              Them
            </span>
          )}
        </div>
      )}

      {/* Selected-by-me checkmark before reveal */}
      {!revealed && selectedByMe && (
        <div className="absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded-full bg-white text-emerald-500 shadow">
          <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden>
            <path
              fillRule="evenodd"
              d="M16.7 5.3a1 1 0 010 1.4l-7 7a1 1 0 01-1.4 0l-4-4a1 1 0 011.4-1.4L9 11.6l6.3-6.3a1 1 0 011.4 0z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      )}
    </button>
  );
}

/**
 * Wrapper matching the pattern used by other games in this folder: parent
 * (`GamesPanel`) hands us the room, we resolve identity + name, and render a
 * friendly placeholder if the partner hasn't joined yet.
 */
export function WouldYouRatherPanel({ room }: { room: Room }) {
  const me = room.localParticipant;
  const partner = [...room.remoteParticipants.values()][0];
  if (!partner) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white/60 p-4 text-center">
        <p className="font-[family-name:var(--font-outfit)] text-sm text-zinc-600">
          Would You Rather needs two players. Waiting for someone to join…
        </p>
      </div>
    );
  }
  return (
    <WouldYouRather
      meIdentity={me.identity}
      partnerIdentity={partner.identity}
      partnerName={partner.name ?? "your partner"}
    />
  );
}
