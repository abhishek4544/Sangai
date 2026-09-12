"use client";

/**
 * Two Truths & a Lie — turn-based text-input couples game.
 *
 * Turn model: sorted identities → `roundIdx % 2` picks the author. Same
 * deterministic trick as How Well & Truth or Dare.
 *
 * Round flow:
 *   1. Author writes 3 statements about themselves + marks one as the lie.
 *      One atomic `submit` event carries all three plus `lieIdx`.
 *   2. Guesser sees the 3 statements as testimony cards and picks which
 *      one they think is the lie → `guess` event.
 *   3. Both screens reveal: truths get a green ring + ✓, the lie gets a
 *      red ring + ✗, the guesser's pick gets a "your guess" badge.
 *   4. Score = correct catches per side. Both peers compute both scores
 *      independently from the same event stream.
 *
 * Wire honesty: `lieIdx` travels in plaintext (schema note in envelope.ts).
 * Trust is the model — couples game, not adversarial.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Room } from "livekit-client";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import type { RoomEvent as ChannelEvent } from "@/lib/room/envelope";

const STATEMENT_MAX = 140;

interface Props {
  meIdentity: string;
  partnerIdentity: string;
  myName: string;
  partnerName: string;
}

interface Submission {
  statements: [string, string, string];
  lieIdx: number;
}

export function TwoTruths({
  meIdentity,
  partnerIdentity,
  myName,
  partnerName,
}: Props) {
  const { sendEvent, subscribe } = useRoomChannel();
  const [roundIdx, setRoundIdx] = useState(0);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [guessIdx, setGuessIdx] = useState<number | null>(null);
  const [scores, setScores] = useState({ me: 0, partner: 0 });
  const countedRoundsRef = useRef<Set<number>>(new Set());

  const orderedIds = useMemo(
    () => [meIdentity, partnerIdentity].sort(),
    [meIdentity, partnerIdentity],
  );
  const authorId = orderedIds[roundIdx % 2];
  const isAuthor = authorId === meIdentity;
  const authorName = isAuthor ? myName : partnerName;
  const guesserName = isAuthor ? partnerName : myName;

  const revealed = submission !== null && guessIdx !== null;
  const guesserWasCorrect =
    revealed && submission!.lieIdx === guessIdx;

  useEffect(() => {
    if (!revealed || countedRoundsRef.current.has(roundIdx)) return;
    countedRoundsRef.current.add(roundIdx);
    // Whichever side was guessing this round gets the point (or the miss).
    setScores((prev) => {
      if (isAuthor) {
        return {
          ...prev,
          partner: prev.partner + (guesserWasCorrect ? 1 : 0),
        };
      }
      return { ...prev, me: prev.me + (guesserWasCorrect ? 1 : 0) };
    });
  }, [revealed, roundIdx, isAuthor, guesserWasCorrect]);

  useEffect(() => {
    const handler = (event: ChannelEvent) => {
      if (event.type !== "twoTruths") return;
      if (event.phase === "reset") {
        setRoundIdx(0);
        setSubmission(null);
        setGuessIdx(null);
        setScores({ me: 0, partner: 0 });
        countedRoundsRef.current = new Set();
        return;
      }
      if (event.phase === "next") {
        if (event.nextIdx <= roundIdx) return;
        setRoundIdx(event.nextIdx);
        setSubmission(null);
        setGuessIdx(null);
        return;
      }
      if (event.phase === "submit") {
        if (event.roundIdx !== roundIdx) return;
        if (event.by !== authorId) return; // ignore off-turn author
        setSubmission({
          statements: event.statements,
          lieIdx: event.lieIdx,
        });
        return;
      }
      if (event.phase === "guess") {
        if (event.roundIdx !== roundIdx) return;
        if (event.by === authorId) return; // author isn't the guesser
        setGuessIdx(event.guessIdx);
        return;
      }
    };
    return subscribe(handler);
  }, [subscribe, roundIdx, authorId]);

  const submit = useCallback(
    (statements: [string, string, string], lieIdx: number) => {
      if (!isAuthor || submission !== null) return;
      setSubmission({ statements, lieIdx });
      void sendEvent({
        type: "twoTruths",
        phase: "submit",
        roundIdx,
        statements,
        lieIdx,
        by: meIdentity,
      });
    },
    [isAuthor, submission, roundIdx, meIdentity, sendEvent],
  );

  const guess = useCallback(
    (idx: number) => {
      if (isAuthor || guessIdx !== null || submission === null) return;
      setGuessIdx(idx);
      void sendEvent({
        type: "twoTruths",
        phase: "guess",
        roundIdx,
        guessIdx: idx,
        by: meIdentity,
      });
    },
    [isAuthor, guessIdx, submission, roundIdx, meIdentity, sendEvent],
  );

  const nextRound = useCallback(() => {
    void sendEvent({
      type: "twoTruths",
      phase: "next",
      nextIdx: roundIdx + 1,
    });
  }, [roundIdx, sendEvent]);

  const reset = useCallback(() => {
    void sendEvent({ type: "twoTruths", phase: "reset" });
  }, [sendEvent]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-xl">
      {/* Backdrop — deep midnight with amber lantern glow. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1000px 260px at 80% 0%, rgba(251,191,36,0.18), transparent 60%), radial-gradient(900px 260px at 20% 100%, rgba(99,102,241,0.22), transparent 60%), linear-gradient(180deg, #1e1b4b 0%, #0f172a 100%)",
        }}
      />

      {/* HUD */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-white/10 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[10px] font-semibold uppercase tracking-[1.5px] text-white/80 ring-1 ring-white/15">
            Round {roundIdx + 1}
          </span>
          <span className="rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[10px] font-semibold uppercase tracking-[1.5px] text-white shadow-sm">
            {scores.me}✓ · {scores.partner} them
          </span>
        </div>
        <button
          type="button"
          onClick={reset}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-white/60 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          New game
        </button>
      </div>

      {/* Prompt banner */}
      <div className="relative flex items-center gap-3 overflow-hidden rounded-2xl bg-white/5 p-3 ring-1 ring-white/10 backdrop-blur">
        <span aria-hidden className="text-2xl">
          🕵️
        </span>
        <div className="flex flex-col">
          <span className="font-[family-name:var(--font-outfit)] text-[10px] font-bold uppercase tracking-[2px] text-amber-300/90">
            {isAuthor ? "You're on the stand" : `${authorName}'s testimony`}
          </span>
          <span className="font-[family-name:var(--font-outfit)] text-sm font-medium text-white/90">
            {isAuthor
              ? "Write 3 statements. Two true, one lie."
              : submission
                ? "Which one is the lie?"
                : `Waiting for ${authorName}…`}
          </span>
        </div>
      </div>

      {/* Body — three modes */}
      <div className="flex min-h-0 flex-1 flex-col">
        {isAuthor && submission === null && (
          <AuthorForm onSubmit={submit} />
        )}
        {isAuthor && submission !== null && !revealed && (
          <WaitingCard
            title="Sent to the jury"
            body={`Waiting for ${guesserName} to guess…`}
          />
        )}
        {!isAuthor && submission === null && (
          <WaitingCard
            title={`${authorName} is writing`}
            body="Testimony incoming — get ready to spot the lie."
          />
        )}
        {!isAuthor && submission !== null && !revealed && (
          <StatementList
            statements={submission.statements}
            revealed={false}
            lieIdx={null}
            guessIdx={guessIdx}
            onPick={guess}
            interactive
          />
        )}
        {revealed && submission && (
          <StatementList
            statements={submission.statements}
            revealed
            lieIdx={submission.lieIdx}
            guessIdx={guessIdx}
            onPick={() => {}}
            interactive={false}
          />
        )}
      </div>

      {/* Footer — result + next */}
      <div className="min-h-[38px]">
        {revealed && (
          <div className="flex flex-col items-center gap-1.5">
            <span
              className={
                "rounded-full px-3 py-0.5 font-[family-name:var(--font-outfit)] text-[11px] font-bold uppercase tracking-[1.5px] shadow-md " +
                (guesserWasCorrect
                  ? "bg-gradient-to-r from-emerald-400 to-teal-500 text-white"
                  : "bg-gradient-to-r from-rose-500 to-orange-500 text-white")
              }
            >
              {guesserWasCorrect
                ? isAuthor
                  ? `${guesserName} caught you 🎯`
                  : "Case closed 🎯"
                : isAuthor
                  ? `${guesserName} fell for it 😈`
                  : "Fooled you 😈"}
            </span>
            <button
              type="button"
              onClick={nextRound}
              className="w-full rounded-xl bg-amber-400 px-3 py-2 font-[family-name:var(--font-outfit)] text-sm font-semibold text-zinc-900 shadow-lg transition hover:bg-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              Swap turns →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function WaitingCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/5 p-4 text-center">
      <div className="flex items-center gap-2">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-70" />
          <span className="relative inline-flex size-2 rounded-full bg-amber-400" />
        </span>
        <p className="font-[family-name:var(--font-outfit)] text-sm font-semibold text-white">
          {title}
        </p>
      </div>
      <p className="font-[family-name:var(--font-outfit)] text-[11px] text-white/60">
        {body}
      </p>
    </div>
  );
}

function AuthorForm({
  onSubmit,
}: {
  onSubmit: (s: [string, string, string], lieIdx: number) => void;
}) {
  const [drafts, setDrafts] = useState<[string, string, string]>(["", "", ""]);
  const [lieIdx, setLieIdx] = useState<number | null>(null);
  const canSubmit =
    drafts.every((s) => s.trim().length > 0) && lieIdx !== null;

  const update = (i: number, value: string) => {
    if (value.length > STATEMENT_MAX) return;
    setDrafts((prev) => {
      const next = [...prev] as [string, string, string];
      next[i] = value;
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {drafts.map((val, i) => {
        const isLie = lieIdx === i;
        return (
          <div
            key={i}
            className={
              "relative flex flex-col gap-1 rounded-xl p-2 transition " +
              (isLie
                ? "bg-rose-500/15 ring-2 ring-rose-400"
                : "bg-white/5 ring-1 ring-white/10")
            }
          >
            <div className="flex items-center gap-2">
              <span className="font-[family-name:var(--font-outfit)] text-[10px] font-bold uppercase tracking-[2px] text-white/60">
                Statement {i + 1}
              </span>
              <button
                type="button"
                onClick={() => setLieIdx(isLie ? null : i)}
                className={
                  "ml-auto rounded-full px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[10px] font-bold uppercase tracking-[1.5px] transition " +
                  (isLie
                    ? "bg-rose-500 text-white shadow"
                    : "bg-white/10 text-white/70 hover:bg-white/20")
                }
              >
                {isLie ? "This is the lie" : "Mark as lie"}
              </button>
            </div>
            <textarea
              value={val}
              onChange={(e) => update(i, e.target.value)}
              rows={2}
              placeholder={
                i === 0
                  ? "I once…"
                  : i === 1
                    ? "Something I secretly love…"
                    : "A thing about me…"
              }
              className="w-full resize-none rounded-md border-none bg-white/5 px-2 py-1.5 font-[family-name:var(--font-outfit)] text-sm text-white placeholder:text-white/30 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <span
              className={
                "self-end font-[family-name:var(--font-outfit)] text-[10px] " +
                (val.length >= STATEMENT_MAX - 20
                  ? "text-amber-300"
                  : "text-white/40")
              }
            >
              {val.length}/{STATEMENT_MAX}
            </span>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => canSubmit && onSubmit(drafts, lieIdx!)}
        disabled={!canSubmit}
        className={
          "mt-auto rounded-xl px-3 py-2.5 font-[family-name:var(--font-outfit)] text-sm font-semibold shadow-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 " +
          (canSubmit
            ? "bg-amber-400 text-zinc-900 hover:bg-amber-300"
            : "cursor-not-allowed bg-white/10 text-white/40")
        }
      >
        {canSubmit ? "Present to jury" : "Fill all 3 + mark the lie"}
      </button>
    </div>
  );
}

interface StatementListProps {
  statements: [string, string, string];
  revealed: boolean;
  lieIdx: number | null;
  guessIdx: number | null;
  onPick: (i: number) => void;
  interactive: boolean;
}

function StatementList({
  statements,
  revealed,
  lieIdx,
  guessIdx,
  onPick,
  interactive,
}: StatementListProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {statements.map((text, i) => {
        const isLie = revealed && lieIdx === i;
        const isGuess = guessIdx === i;
        const isTruth = revealed && lieIdx !== i;
        return (
          <button
            key={i}
            type="button"
            onClick={() => interactive && onPick(i)}
            disabled={!interactive}
            className={
              "group relative flex items-start gap-3 overflow-hidden rounded-xl p-3 text-left transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 " +
              (interactive ? "hover:scale-[1.01] active:scale-[0.99]" : "") +
              " " +
              (revealed
                ? isLie
                  ? "bg-rose-500/20 ring-2 ring-rose-400"
                  : isTruth
                    ? "bg-emerald-500/15 ring-2 ring-emerald-400"
                    : "bg-white/5 ring-1 ring-white/10"
                : isGuess
                  ? "bg-amber-400/20 ring-2 ring-amber-400"
                  : "bg-white/8 ring-1 ring-white/15 hover:bg-white/15")
            }
          >
            {/* Statement number chip */}
            <span
              className={
                "flex size-8 shrink-0 items-center justify-center rounded-full font-[family-name:var(--font-outfit)] text-sm font-black " +
                (revealed
                  ? isLie
                    ? "bg-rose-500 text-white"
                    : "bg-emerald-500 text-white"
                  : "bg-white/20 text-white")
              }
            >
              {i + 1}
            </span>
            <p className="min-w-0 flex-1 font-[family-name:var(--font-outfit)] text-[13px] leading-snug text-white sm:text-sm">
              {text}
            </p>
            {/* Reveal badges */}
            {revealed && isLie && (
              <span className="absolute right-2 top-2 rounded-full bg-rose-500 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[9px] font-bold uppercase tracking-[1px] text-white shadow">
                The lie
              </span>
            )}
            {revealed && isTruth && (
              <span className="absolute right-2 top-2 rounded-full bg-emerald-500 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[9px] font-bold uppercase tracking-[1px] text-white shadow">
                Truth
              </span>
            )}
            {revealed && isGuess && (
              <span className="absolute bottom-2 right-2 rounded-full bg-white/90 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[9px] font-bold uppercase tracking-[1px] text-zinc-800 shadow">
                Your guess
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TwoTruthsPanel({ room }: { room: Room }) {
  const me = room.localParticipant;
  const partner = [...room.remoteParticipants.values()][0];
  if (!partner) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white/60 p-4 text-center">
        <p className="font-[family-name:var(--font-outfit)] text-sm text-zinc-600">
          Two Truths & a Lie needs two players. Waiting for someone to join…
        </p>
      </div>
    );
  }
  return (
    <TwoTruths
      meIdentity={me.identity}
      partnerIdentity={partner.identity}
      myName={me.name ?? "You"}
      partnerName={partner.name ?? "your partner"}
    />
  );
}
