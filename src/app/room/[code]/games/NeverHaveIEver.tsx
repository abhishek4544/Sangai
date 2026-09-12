"use client";

/**
 * Never Have I Ever — arcade-styled couples confession game.
 *
 * Sync model mirrors Would You Rather: no roomState field, both peers derive
 * round state from the ordered event stream, `roundIdx` bumps forward-only,
 * stale answers dropped. Score = # of rounds both picked the same answer,
 * derived locally from the shared stream.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Room } from "livekit-client";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import type { RoomEvent as ChannelEvent } from "@/lib/room/envelope";
import { getNHIEPrompt, NHIE_DECK_LENGTH } from "@/lib/games/never-have-i-ever";
import { getWeekSeed } from "@/lib/games/shuffle";

type Answer = "have" | "never";

interface Props {
  meIdentity: string;
  partnerIdentity: string;
  partnerName: string;
}

interface RoundAnswers {
  me: Answer | null;
  partner: Answer | null;
}

export function NeverHaveIEver({ meIdentity, partnerIdentity, partnerName }: Props) {
  const { sendEvent, subscribe } = useRoomChannel();
  const [roundIdx, setRoundIdx] = useState(0);
  const [answers, setAnswers] = useState<RoundAnswers>({ me: null, partner: null });
  const [score, setScore] = useState({ matched: 0, played: 0 });
  const countedRoundsRef = useRef<Set<number>>(new Set());
  const [revealed, setRevealed] = useState(false);

  // Same weekly-seeded shuffle as WYR — both peers on the same UTC week
  // converge on the same permutation with no coordination.
  const weekSeed = useMemo(() => getWeekSeed(), []);
  const prompt = useMemo(
    () => getNHIEPrompt(roundIdx, weekSeed),
    [roundIdx, weekSeed],
  );
  const bothIn = answers.me !== null && answers.partner !== null;
  const isMatch = bothIn && answers.me === answers.partner;
  const bothGuilty = bothIn && answers.me === "have" && answers.partner === "have";

  useEffect(() => {
    if (bothIn && !countedRoundsRef.current.has(roundIdx)) {
      countedRoundsRef.current.add(roundIdx);
      setScore((s) => ({
        matched: s.matched + (answers.me === answers.partner ? 1 : 0),
        played: s.played + 1,
      }));
      setRevealed(true);
    }
  }, [bothIn, roundIdx, answers.me, answers.partner]);

  useEffect(() => {
    const handler = (event: ChannelEvent) => {
      if (event.type !== "neverHaveIEver") return;
      if (event.phase === "reset") {
        setRoundIdx(0);
        setAnswers({ me: null, partner: null });
        setScore({ matched: 0, played: 0 });
        countedRoundsRef.current = new Set();
        setRevealed(false);
        return;
      }
      if (event.phase === "next") {
        if (event.nextIdx <= roundIdx) return;
        setRoundIdx(event.nextIdx);
        setAnswers({ me: null, partner: null });
        setRevealed(false);
        return;
      }
      if (event.phase === "answer") {
        if (event.roundIdx !== roundIdx) return;
        setAnswers((prev) => {
          if (event.by === meIdentity) return { ...prev, me: event.answer };
          if (event.by === partnerIdentity) return { ...prev, partner: event.answer };
          return prev;
        });
        return;
      }
    };
    return subscribe(handler);
  }, [subscribe, roundIdx, meIdentity, partnerIdentity]);

  const answer = useCallback(
    (choice: Answer) => {
      if (answers.me !== null) return;
      setAnswers((prev) => ({ ...prev, me: choice }));
      void sendEvent({
        type: "neverHaveIEver",
        phase: "answer",
        roundIdx,
        answer: choice,
        by: meIdentity,
      });
    },
    [answers.me, roundIdx, meIdentity, sendEvent],
  );

  const nextRound = useCallback(() => {
    void sendEvent({
      type: "neverHaveIEver",
      phase: "next",
      nextIdx: roundIdx + 1,
    });
  }, [roundIdx, sendEvent]);

  const reset = useCallback(() => {
    void sendEvent({ type: "neverHaveIEver", phase: "reset" });
  }, [sendEvent]);

  const roundNumber = (roundIdx % NHIE_DECK_LENGTH) + 1;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-xl">
      {/* Backdrop — cooler palette than WYR to give NHIE its own identity */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1000px 260px at 90% 0%, rgba(139,92,246,0.20), transparent 60%), radial-gradient(900px 260px at 10% 100%, rgba(251,146,60,0.18), transparent 60%), linear-gradient(180deg, #fafaf9 0%, #f5f5f4 100%)",
        }}
      />

      {/* HUD row */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-white/80 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[10px] font-semibold uppercase tracking-[1.5px] text-zinc-600 shadow-sm ring-1 ring-black/5">
            Round {roundNumber}
          </span>
          <span className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[10px] font-semibold uppercase tracking-[1.5px] text-white shadow-sm">
            {score.matched}/{score.played} matched
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

      {/* Prompt card */}
      <div
        className="relative flex min-h-[140px] flex-col justify-center overflow-hidden rounded-2xl p-5 text-white shadow-xl"
        style={{
          background:
            "linear-gradient(135deg, #1e1b4b 0%, #4c1d95 45%, #7c2d92 100%)",
        }}
      >
        {/* Big watermark glyph */}
        <span
          aria-hidden
          className="pointer-events-none absolute -right-2 -top-3 text-[110px] leading-none opacity-15"
        >
          {prompt.flavor ?? "🤫"}
        </span>
        {/* Sparkle overlay */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(500px 120px at 30% 0%, rgba(255,255,255,0.18), transparent 60%)",
          }}
        />
        <div className="relative z-10 flex flex-col gap-1.5">
          <span className="font-[family-name:var(--font-outfit)] text-[10px] font-bold uppercase tracking-[3px] text-white/70">
            Never have I ever…
          </span>
          <p className="font-[family-name:var(--font-outfit)] text-xl font-bold leading-tight text-white drop-shadow-sm sm:text-2xl">
            {prompt.text}
          </p>
        </div>
      </div>

      {/* Verdict buttons */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
        <VerdictButton
          side="have"
          label="I have"
          sub="guilty 😏"
          disabled={answers.me !== null}
          selectedByMe={answers.me === "have"}
          selectedByPartner={answers.partner === "have"}
          revealed={revealed}
          isMatch={isMatch && answers.me === "have"}
          onClick={() => answer("have")}
        />
        <VerdictButton
          side="never"
          label="Never"
          sub="innocent 😇"
          disabled={answers.me !== null}
          selectedByMe={answers.me === "never"}
          selectedByPartner={answers.partner === "never"}
          revealed={revealed}
          isMatch={isMatch && answers.me === "never"}
          onClick={() => answer("never")}
        />
      </div>

      {/* Footer */}
      <div className="min-h-[38px]">
        {!bothIn && answers.me === null && (
          <p className="text-center font-[family-name:var(--font-outfit)] text-[12px] text-zinc-500">
            Answer honestly — reveal together.
          </p>
        )}
        {!bothIn && answers.me !== null && (
          <div className="flex items-center justify-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-violet-400 opacity-70" />
              <span className="relative inline-flex size-2 rounded-full bg-violet-500" />
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
                "rounded-full px-3 py-0.5 font-[family-name:var(--font-outfit)] text-[11px] font-bold uppercase tracking-[1.5px] shadow-md " +
                (bothGuilty
                  ? "bg-gradient-to-r from-rose-500 to-orange-500 text-white"
                  : isMatch
                    ? "bg-gradient-to-r from-emerald-400 to-teal-500 text-white"
                    : "bg-gradient-to-r from-amber-300 to-yellow-500 text-white")
              }
            >
              {bothGuilty
                ? "Both guilty 🔥"
                : isMatch
                  ? "Both innocent ✨"
                  : "Plot twist 👀"}
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

interface VerdictButtonProps {
  side: Answer;
  label: string;
  sub: string;
  disabled: boolean;
  selectedByMe: boolean;
  selectedByPartner: boolean;
  revealed: boolean;
  isMatch: boolean;
  onClick: () => void;
}

function VerdictButton({
  side,
  label,
  sub,
  disabled,
  selectedByMe,
  selectedByPartner,
  revealed,
  isMatch,
  onClick,
}: VerdictButtonProps) {
  // "have" = warm confessional gradient; "never" = cool halo gradient.
  const palette =
    side === "have"
      ? {
          bg: "linear-gradient(135deg, #f43f5e 0%, #f59e0b 100%)",
          glow: "0 18px 34px -12px rgba(244, 63, 94, 0.55)",
          matchRing: "ring-rose-300",
          icon: "🙋",
        }
      : {
          bg: "linear-gradient(135deg, #8b5cf6 0%, #38bdf8 100%)",
          glow: "0 18px 34px -12px rgba(139, 92, 246, 0.55)",
          matchRing: "ring-violet-300",
          icon: "🙈",
        };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "group relative flex min-h-0 flex-1 flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl px-3 py-4 transition-all duration-200 focus:outline-none focus-visible:ring-4 " +
        (disabled ? "cursor-default" : "hover:scale-[1.02] active:scale-[0.98]") +
        " " +
        palette.matchRing +
        (selectedByMe || selectedByPartner ? " ring-4 ring-white/90" : "")
      }
      style={{
        background: palette.bg,
        boxShadow: palette.glow,
      }}
    >
      {/* Shimmer on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(400px 100px at 50% -20%, rgba(255,255,255,0.35), transparent 60%)",
        }}
      />

      {/* Match pulse */}
      {isMatch && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-pulse"
          style={{
            background:
              "radial-gradient(300px 160px at 50% 50%, rgba(255,255,255,0.35), transparent 70%)",
          }}
        />
      )}

      <span aria-hidden className="relative z-10 text-3xl drop-shadow-sm">
        {palette.icon}
      </span>
      <span className="relative z-10 font-[family-name:var(--font-outfit)] text-base font-bold text-white drop-shadow-sm">
        {label}
      </span>
      <span className="relative z-10 font-[family-name:var(--font-outfit)] text-[10px] font-medium uppercase tracking-[1.5px] text-white/85">
        {sub}
      </span>

      {revealed && (
        <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 gap-1">
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

export function NeverHaveIEverPanel({ room }: { room: Room }) {
  const me = room.localParticipant;
  const partner = [...room.remoteParticipants.values()][0];
  if (!partner) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white/60 p-4 text-center">
        <p className="font-[family-name:var(--font-outfit)] text-sm text-zinc-600">
          Never Have I Ever needs two players. Waiting for someone to join…
        </p>
      </div>
    );
  }
  return (
    <NeverHaveIEver
      meIdentity={me.identity}
      partnerIdentity={partner.identity}
      partnerName={partner.name ?? "your partner"}
    />
  );
}
