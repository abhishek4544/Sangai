"use client";

/**
 * Movie Trivia — 10-question round, both partners answer independently,
 * reveal side-by-side after both have locked in.
 *
 * Sync model: subscribe-driven, no roomState field (matches Truth or Dare /
 * Draw Together). Both peers hold a fixed-order deck, so a `questionIdx`
 * on the wire is enough — no deck payload per question.
 *
 * Timing: an answer is broadcast the moment it's tapped; the reveal fires
 * for both peers as soon as both `answer` events for the current index have
 * arrived (LOSSY-safe: if the partner's answer is missed, "Next" resyncs).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Room } from "livekit-client";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import type { RoomEvent as ChannelEvent } from "@/lib/room/envelope";
import {
  ROUND_LENGTH,
  TRIVIA_QUESTIONS,
  getTriviaQuestion,
} from "@/lib/games/movie-trivia";

interface Props {
  meIdentity: string;
  partnerIdentity: string;
  partnerName: string;
}

export function MovieTrivia({ meIdentity, partnerIdentity, partnerName }: Props) {
  const { sendEvent, subscribe } = useRoomChannel();
  const [idx, setIdx] = useState(0);
  const [myAnswer, setMyAnswer] = useState<number | null>(null);
  const [partnerAnswer, setPartnerAnswer] = useState<number | null>(null);
  // Score tracked separately so we can display running totals + a final
  // scoreboard when the round ends.
  const [myScore, setMyScore] = useState(0);
  const [partnerScore, setPartnerScore] = useState(0);

  const q = getTriviaQuestion(idx);

  // Inbound event stream — treats the partner's identity as the "other" side.
  useEffect(() => {
    const handler = (event: ChannelEvent, from: string) => {
      if (event.type !== "movieTrivia") return;
      if (event.phase === "answer") {
        // Ignore stale answers targeted at a prior question.
        if (event.questionIdx !== idx) return;
        if (event.by === meIdentity) {
          // Echo of our own answer (sendEvent applies locally); ignore.
          void from;
          return;
        }
        setPartnerAnswer(event.optionIdx);
        return;
      }
      if (event.phase === "next") {
        setIdx(event.nextIdx);
        setMyAnswer(null);
        setPartnerAnswer(null);
        return;
      }
      if (event.phase === "reset") {
        setIdx(0);
        setMyAnswer(null);
        setPartnerAnswer(null);
        setMyScore(0);
        setPartnerScore(0);
      }
    };
    return subscribe(handler);
  }, [subscribe, idx, meIdentity]);

  // Score bump — only counts each question once, when the reveal appears.
  const bothAnswered = myAnswer !== null && partnerAnswer !== null;
  useEffect(() => {
    if (!bothAnswered || !q) return;
    if (myAnswer === q.correctIdx) setMyScore((s) => s + 1);
    if (partnerAnswer === q.correctIdx) setPartnerScore((s) => s + 1);
    // Intentionally not depending on `q` — the questionIdx already gates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bothAnswered, idx]);

  const answer = useCallback(
    (optionIdx: number) => {
      if (myAnswer !== null) return;
      setMyAnswer(optionIdx);
      void sendEvent({
        type: "movieTrivia",
        phase: "answer",
        questionIdx: idx,
        optionIdx,
        by: meIdentity,
      });
    },
    [myAnswer, sendEvent, idx, meIdentity],
  );

  const next = useCallback(() => {
    const nextIdx = idx + 1;
    setIdx(nextIdx);
    setMyAnswer(null);
    setPartnerAnswer(null);
    void sendEvent({ type: "movieTrivia", phase: "next", nextIdx });
  }, [idx, sendEvent]);

  const reset = useCallback(() => {
    setIdx(0);
    setMyAnswer(null);
    setPartnerAnswer(null);
    setMyScore(0);
    setPartnerScore(0);
    void sendEvent({ type: "movieTrivia", phase: "reset" });
  }, [sendEvent]);

  // End-of-round: show scoreboard.
  const roundOver =
    idx >= ROUND_LENGTH || idx >= TRIVIA_QUESTIONS.length;

  const progressLabel = useMemo(
    () => `Q ${Math.min(idx + 1, ROUND_LENGTH)} / ${ROUND_LENGTH}`,
    [idx],
  );

  if (roundOver) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <ScoreHeader
          myScore={myScore}
          partnerScore={partnerScore}
          partnerName={partnerName}
          progressLabel={`Round complete`}
        />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-xl bg-indigo-50 p-4 text-center">
          <div className="text-4xl">
            {myScore === partnerScore ? "🤝" : myScore > partnerScore ? "🏆" : "👏"}
          </div>
          <p className="font-[family-name:var(--font-outfit)] text-base font-semibold text-indigo-900">
            {myScore === partnerScore
              ? "A perfect tie."
              : myScore > partnerScore
                ? "You edged it out!"
                : `${partnerName} wins this round.`}
          </p>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex flex-col items-center">
              <span className="font-mono text-2xl font-bold text-zinc-900">
                {myScore}
              </span>
              <span className="text-xs text-zinc-500">You</span>
            </div>
            <span className="text-zinc-400">·</span>
            <div className="flex flex-col items-center">
              <span className="font-mono text-2xl font-bold text-zinc-900">
                {partnerScore}
              </span>
              <span className="text-xs text-zinc-500">{partnerName}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-indigo-600 px-4 py-2 font-[family-name:var(--font-outfit)] text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            Play again
          </button>
        </div>
      </div>
    );
  }

  if (!q) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white/60 p-4 text-center">
        <p className="font-[family-name:var(--font-outfit)] text-sm text-zinc-600">
          No more questions in the deck.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ScoreHeader
        myScore={myScore}
        partnerScore={partnerScore}
        partnerName={partnerName}
        progressLabel={progressLabel}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        <p className="rounded-lg bg-indigo-50 p-3 font-[family-name:var(--font-outfit)] text-sm font-medium leading-snug text-zinc-900">
          {q.question}
        </p>
        <div className="flex flex-col gap-1.5">
          {q.options.map((opt, i) => {
            const isMine = myAnswer === i;
            const isTheirs = partnerAnswer === i;
            const isCorrect = q.correctIdx === i;
            const revealed = bothAnswered;
            return (
              <button
                key={i}
                type="button"
                onClick={() => answer(i)}
                disabled={myAnswer !== null}
                className={
                  "flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-left font-[family-name:var(--font-outfit)] text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 " +
                  optionClass({ isMine, isCorrect, revealed })
                }
              >
                <span
                  aria-hidden
                  className="flex size-6 items-center justify-center rounded-full bg-white text-xs font-semibold text-zinc-700 shadow-sm"
                >
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="flex-1">{opt}</span>
                {revealed && isCorrect && (
                  <span aria-hidden className="text-emerald-600">
                    ✓
                  </span>
                )}
                {revealed && isMine && !isCorrect && (
                  <span aria-hidden className="text-rose-600">
                    ✗
                  </span>
                )}
                {revealed && isTheirs && (
                  <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-800">
                    {partnerName}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer — status + Next */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-zinc-500">
          {bothAnswered
            ? "Both answered — reveal below."
            : myAnswer === null
              ? "Tap your answer"
              : `Waiting for ${partnerName}…`}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={reset}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!bothAnswered}
            className="rounded-lg bg-indigo-600 px-3 py-2 font-[family-name:var(--font-outfit)] text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Helpers -------------------------------------------------------------

function optionClass({
  isMine,
  isCorrect,
  revealed,
}: {
  isMine: boolean;
  isCorrect: boolean;
  revealed: boolean;
}): string {
  if (!revealed) {
    return isMine
      ? "border-indigo-500 bg-indigo-50"
      : "border-zinc-200 bg-white hover:border-indigo-200 hover:bg-indigo-50";
  }
  if (isCorrect) return "border-emerald-400 bg-emerald-50";
  if (isMine) return "border-rose-400 bg-rose-50";
  return "border-zinc-200 bg-white opacity-70";
}

function ScoreHeader({
  myScore,
  partnerScore,
  partnerName,
  progressLabel,
}: {
  myScore: number;
  partnerScore: number;
  partnerName: string;
  progressLabel: string;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="rounded-full bg-indigo-100 px-2 py-1 font-mono font-semibold text-indigo-800">
        {progressLabel}
      </span>
      <div className="flex items-center gap-2 font-mono">
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-zinc-800">
          You <b>{myScore}</b>
        </span>
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-zinc-800">
          {partnerName} <b>{partnerScore}</b>
        </span>
      </div>
    </div>
  );
}

// ---- Panel wrapper (reads room, handles solo state) ---------------------

export function MovieTriviaPanel({ room }: { room: Room }) {
  const me = room.localParticipant;
  const partner = [...room.remoteParticipants.values()][0];
  if (!partner) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white/60 p-4 text-center">
        <p className="font-[family-name:var(--font-outfit)] text-sm text-zinc-600">
          Movie Trivia needs two players. Waiting for someone to join…
        </p>
      </div>
    );
  }
  return (
    <MovieTrivia
      meIdentity={me.identity}
      partnerIdentity={partner.identity}
      partnerName={partner.name ?? "your partner"}
    />
  );
}
