"use client";

/**
 * How Well Do You Know Me — turn-based multiple-choice couples game.
 *
 * Turn model: sorted identities → `roundIdx % 2` picks the subject. Both
 * peers derive the same subject deterministically without coordination
 * (same trick used in Truth or Dare).
 *
 * Round flow:
 *   1. Subject taps the option that's true for them → `subject-pick` event.
 *      Their own screen shows a "locked in" state; guesser sees a placeholder.
 *   2. Guesser taps their guess → `guess` event.
 *   3. Both screens reveal: subject sees whether partner got it; guesser
 *      sees the truth and their result.
 *   4. Either taps Next → turns swap.
 *
 * Wire honesty note: nothing prevents the guesser's client from decoding
 * the `subject-pick` event early and peeking at the answer — this is a
 * couples game, we trust both peers. If it ever needs to become adversarial
 * we'd have to commit-reveal (subject sends hash first, opens later).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Room } from "livekit-client";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import type { RoomEvent as ChannelEvent } from "@/lib/room/envelope";
import { getHWPrompt, HW_DECK_LENGTH } from "@/lib/games/how-well";
import { getWeekSeed } from "@/lib/games/shuffle";

interface Props {
  meIdentity: string;
  partnerIdentity: string;
  myName: string;
  partnerName: string;
}

interface RoundState {
  subjectPickIdx: number | null;
  guessIdx: number | null;
}

export function HowWell({
  meIdentity,
  partnerIdentity,
  myName,
  partnerName,
}: Props) {
  const { sendEvent, subscribe } = useRoomChannel();
  const [roundIdx, setRoundIdx] = useState(0);
  const [round, setRound] = useState<RoundState>({
    subjectPickIdx: null,
    guessIdx: null,
  });
  const [score, setScore] = useState({ correct: 0, played: 0 });
  const countedRoundsRef = useRef<Set<number>>(new Set());

  // Deterministic subject: sorted identities → turn % 2.
  const orderedIds = useMemo(
    () => [meIdentity, partnerIdentity].sort(),
    [meIdentity, partnerIdentity],
  );
  const subjectId = orderedIds[roundIdx % 2];
  const isSubject = subjectId === meIdentity;
  const subjectName = isSubject ? myName : partnerName;

  const weekSeed = useMemo(() => getWeekSeed(), []);
  const prompt = useMemo(
    () => getHWPrompt(roundIdx, weekSeed),
    [roundIdx, weekSeed],
  );

  const bothIn = round.subjectPickIdx !== null && round.guessIdx !== null;
  const wasCorrect = bothIn && round.subjectPickIdx === round.guessIdx;

  // Score ticks once per round when both events land. The guesser's client
  // and the subject's client both count independently but arrive at the
  // same {correct, played} totals because the event stream is identical.
  useEffect(() => {
    if (bothIn && !countedRoundsRef.current.has(roundIdx)) {
      countedRoundsRef.current.add(roundIdx);
      setScore((s) => ({
        correct: s.correct + (round.subjectPickIdx === round.guessIdx ? 1 : 0),
        played: s.played + 1,
      }));
    }
  }, [bothIn, roundIdx, round.subjectPickIdx, round.guessIdx]);

  useEffect(() => {
    const handler = (event: ChannelEvent) => {
      if (event.type !== "howWell") return;
      if (event.phase === "reset") {
        setRoundIdx(0);
        setRound({ subjectPickIdx: null, guessIdx: null });
        setScore({ correct: 0, played: 0 });
        countedRoundsRef.current = new Set();
        return;
      }
      if (event.phase === "next") {
        if (event.nextIdx <= roundIdx) return;
        setRoundIdx(event.nextIdx);
        setRound({ subjectPickIdx: null, guessIdx: null });
        return;
      }
      if (event.phase === "subject-pick") {
        if (event.roundIdx !== roundIdx) return;
        if (event.by !== subjectId) return; // ignore off-turn sender
        setRound((r) => ({ ...r, subjectPickIdx: event.optionIdx }));
        return;
      }
      if (event.phase === "guess") {
        if (event.roundIdx !== roundIdx) return;
        if (event.by === subjectId) return; // subject can't be the guesser
        setRound((r) => ({ ...r, guessIdx: event.optionIdx }));
        return;
      }
    };
    return subscribe(handler);
  }, [subscribe, roundIdx, subjectId]);

  const pickSubject = useCallback(
    (optionIdx: number) => {
      if (!isSubject || round.subjectPickIdx !== null) return;
      setRound((r) => ({ ...r, subjectPickIdx: optionIdx }));
      void sendEvent({
        type: "howWell",
        phase: "subject-pick",
        roundIdx,
        optionIdx,
        by: meIdentity,
      });
    },
    [isSubject, round.subjectPickIdx, roundIdx, meIdentity, sendEvent],
  );

  const guess = useCallback(
    (optionIdx: number) => {
      if (isSubject || round.guessIdx !== null) return;
      setRound((r) => ({ ...r, guessIdx: optionIdx }));
      void sendEvent({
        type: "howWell",
        phase: "guess",
        roundIdx,
        optionIdx,
        by: meIdentity,
      });
    },
    [isSubject, round.guessIdx, roundIdx, meIdentity, sendEvent],
  );

  const nextRound = useCallback(() => {
    void sendEvent({ type: "howWell", phase: "next", nextIdx: roundIdx + 1 });
  }, [roundIdx, sendEvent]);

  const reset = useCallback(() => {
    void sendEvent({ type: "howWell", phase: "reset" });
  }, [sendEvent]);

  const roundNumber = (roundIdx % HW_DECK_LENGTH) + 1;

  // What each option button should render depends on:
  //   - Am I the subject or guesser?
  //   - Has the subject picked yet?
  //   - Have I picked?
  //   - Are we in reveal?
  const showReveal = bothIn;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-xl">
      {/* Backdrop — mint/rose blend, distinct from other games. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1000px 260px at 10% 0%, rgba(16,185,129,0.20), transparent 60%), radial-gradient(900px 260px at 90% 100%, rgba(244,114,182,0.18), transparent 60%), linear-gradient(180deg, #f0fdfa 0%, #ecfeff 100%)",
        }}
      />

      {/* HUD */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-white/85 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[10px] font-semibold uppercase tracking-[1.5px] text-zinc-600 shadow-sm ring-1 ring-black/5">
            Round {roundNumber}
          </span>
          <span className="rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[10px] font-semibold uppercase tracking-[1.5px] text-white shadow-sm">
            {score.correct}/{score.played} right
          </span>
        </div>
        <button
          type="button"
          onClick={reset}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          New game
        </button>
      </div>

      {/* Prompt card */}
      <div
        className="relative flex min-h-[110px] flex-col justify-center overflow-hidden rounded-2xl p-4 text-white shadow-xl"
        style={{
          background:
            "linear-gradient(135deg, #0f766e 0%, #0891b2 50%, #7c3aed 100%)",
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -right-3 -top-4 text-[100px] leading-none opacity-15"
        >
          {prompt.flavor ?? "💭"}
        </span>
        <div className="relative z-10 flex flex-col gap-1">
          <span className="font-[family-name:var(--font-outfit)] text-[10px] font-bold uppercase tracking-[3px] text-white/80">
            {isSubject
              ? "You're the subject — answer honestly"
              : `Guess ${subjectName}'s answer`}
          </span>
          <p className="font-[family-name:var(--font-outfit)] text-lg font-bold leading-tight text-white drop-shadow-sm sm:text-xl">
            {prompt.question}
          </p>
        </div>
      </div>

      {/* Option grid */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
        {prompt.options.map((opt, i) => {
          const iPicked = isSubject
            ? round.subjectPickIdx === i
            : round.guessIdx === i;
          const truth = round.subjectPickIdx === i;
          return (
            <OptionButton
              key={i}
              index={i}
              label={opt}
              disabled={
                showReveal ||
                (isSubject ? round.subjectPickIdx !== null : round.guessIdx !== null)
              }
              iPicked={iPicked}
              revealed={showReveal}
              isTruth={truth}
              isGuess={showReveal && round.guessIdx === i}
              wasCorrect={wasCorrect}
              onClick={() => (isSubject ? pickSubject(i) : guess(i))}
            />
          );
        })}
      </div>

      {/* Footer */}
      <div className="min-h-[38px]">
        {!showReveal && isSubject && round.subjectPickIdx === null && (
          <p className="text-center font-[family-name:var(--font-outfit)] text-[12px] text-zinc-500">
            Pick what&apos;s true for you. {partnerName} will guess.
          </p>
        )}
        {!showReveal && isSubject && round.subjectPickIdx !== null && (
          <div className="flex items-center justify-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-teal-400 opacity-70" />
              <span className="relative inline-flex size-2 rounded-full bg-teal-500" />
            </span>
            <p className="font-[family-name:var(--font-outfit)] text-[12px] text-zinc-600">
              Locked in. Waiting for {partnerName} to guess…
            </p>
          </div>
        )}
        {!showReveal && !isSubject && round.subjectPickIdx === null && (
          <div className="flex items-center justify-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-teal-400 opacity-70" />
              <span className="relative inline-flex size-2 rounded-full bg-teal-500" />
            </span>
            <p className="font-[family-name:var(--font-outfit)] text-[12px] text-zinc-600">
              Waiting for {subjectName} to answer…
            </p>
          </div>
        )}
        {!showReveal && !isSubject && round.subjectPickIdx !== null && round.guessIdx === null && (
          <p className="text-center font-[family-name:var(--font-outfit)] text-[12px] text-zinc-500">
            Your turn — take a guess.
          </p>
        )}
        {showReveal && (
          <div className="flex flex-col items-center gap-1.5">
            <span
              className={
                "rounded-full px-3 py-0.5 font-[family-name:var(--font-outfit)] text-[11px] font-bold uppercase tracking-[1.5px] shadow-md " +
                (wasCorrect
                  ? "bg-gradient-to-r from-emerald-400 to-teal-500 text-white"
                  : "bg-gradient-to-r from-rose-400 to-fuchsia-500 text-white")
              }
            >
              {wasCorrect
                ? isSubject
                  ? `${partnerName} knows you 💚`
                  : "Nailed it 💚"
                : isSubject
                  ? `${partnerName} guessed wrong 💔`
                  : "Not this time 💔"}
            </span>
            <button
              type="button"
              onClick={nextRound}
              className="w-full rounded-xl bg-zinc-900 px-3 py-2 font-[family-name:var(--font-outfit)] text-sm font-semibold text-white shadow-lg transition hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-700"
            >
              Swap turns →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface OptionButtonProps {
  index: number;
  label: string;
  disabled: boolean;
  iPicked: boolean;
  revealed: boolean;
  /** Was this option the subject's true answer? */
  isTruth: boolean;
  /** Was this option the guesser's guess? */
  isGuess: boolean;
  wasCorrect: boolean;
  onClick: () => void;
}

function OptionButton({
  index,
  label,
  disabled,
  iPicked,
  revealed,
  isTruth,
  isGuess,
  onClick,
}: OptionButtonProps) {
  // Four visual identities, one per option slot — makes the grid feel
  // playful instead of a wall of grey pills.
  const palettes = [
    { bg: "linear-gradient(135deg, #14b8a6 0%, #06b6d4 100%)", glow: "rgba(20,184,166,0.5)" },
    { bg: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)", glow: "rgba(168,85,247,0.5)" },
    { bg: "linear-gradient(135deg, #f97316 0%, #f59e0b 100%)", glow: "rgba(249,115,22,0.5)" },
    { bg: "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)", glow: "rgba(59,130,246,0.5)" },
  ];
  const palette = palettes[index];

  // Reveal modifies the visual: truth glows green, wrong-guess glows rose,
  // untouched options fade back.
  const revealTint = revealed
    ? isTruth
      ? " ring-4 ring-emerald-300"
      : isGuess
        ? " ring-4 ring-rose-300"
        : " opacity-60"
    : "";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "group relative flex min-h-0 flex-1 flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl px-3 py-3 transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/70 " +
        (disabled ? "cursor-default" : "hover:scale-[1.02] active:scale-[0.98]") +
        (iPicked && !revealed ? " ring-4 ring-white/90" : "") +
        revealTint
      }
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

      <span className="relative z-10 text-center font-[family-name:var(--font-outfit)] text-sm font-semibold leading-tight text-white drop-shadow-sm sm:text-base">
        {label}
      </span>

      {/* Reveal badges: ✓ for truth, "guess" tag for what the guesser tried. */}
      {revealed && isTruth && (
        <span className="absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded-full bg-white text-emerald-500 shadow">
          <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden>
            <path
              fillRule="evenodd"
              d="M16.7 5.3a1 1 0 010 1.4l-7 7a1 1 0 01-1.4 0l-4-4a1 1 0 011.4-1.4L9 11.6l6.3-6.3a1 1 0 011.4 0z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      )}
      {revealed && isGuess && !isTruth && (
        <span className="absolute right-2 top-2 z-10 rounded-full bg-white/90 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[9px] font-bold uppercase tracking-[1px] text-rose-600 shadow">
          Guess
        </span>
      )}

      {/* Pre-reveal: only my own pick shows a checkmark. */}
      {!revealed && iPicked && (
        <span className="absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded-full bg-white text-emerald-500 shadow">
          <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden>
            <path
              fillRule="evenodd"
              d="M16.7 5.3a1 1 0 010 1.4l-7 7a1 1 0 01-1.4 0l-4-4a1 1 0 011.4-1.4L9 11.6l6.3-6.3a1 1 0 011.4 0z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      )}
    </button>
  );
}

export function HowWellPanel({ room }: { room: Room }) {
  const me = room.localParticipant;
  const partner = [...room.remoteParticipants.values()][0];
  if (!partner) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white/60 p-4 text-center">
        <p className="font-[family-name:var(--font-outfit)] text-sm text-zinc-600">
          How Well Do You Know Me needs two players. Waiting for someone to join…
        </p>
      </div>
    );
  }
  return (
    <HowWell
      meIdentity={me.identity}
      partnerIdentity={partner.identity}
      myName={me.name ?? "You"}
      partnerName={partner.name ?? "your partner"}
    />
  );
}
