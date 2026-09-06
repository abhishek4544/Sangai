"use client";

/**
 * Emoji Charades — turn-based movie-guessing game.
 *
 * Turn model: sorted identities → `turn % 2` picks the clue-giver. Both peers
 * walk a shared, fixed-order deck by `movieIdx`, so the wire only carries an
 * integer index (see `emoji-charades.ts`).
 *
 * Sync: subscribe-driven, no roomState field (matches MovieTrivia).
 *  - Clue-giver types emojis, hits Send → `clue` event.
 *  - Guesser types text, hits Enter → local fuzzy match against the shared
 *    deck. On match, broadcasts `reveal { correct: true }`; on miss, broadcasts
 *    `guess { text }` so the clue-giver sees the attempt.
 *  - Clue-giver can hit "Reveal" to end a round early → `reveal { correct: false }`.
 *  - Either peer hits "Next round" → `next { nextTurn, nextMovieIdx }`.
 *
 * Late-join / refresh: whoever missed the events sees turn 0 with no clue.
 * "Reset" resyncs both peers.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Room } from "livekit-client";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import type { RoomEvent as ChannelEvent } from "@/lib/room/envelope";
import {
  EMOJI_MOVIES,
  getEmojiMovie,
  isCorrectGuess,
} from "@/lib/games/emoji-charades";

interface Props {
  meIdentity: string;
  partnerIdentity: string;
  partnerName: string;
}

interface GuessLog {
  text: string;
  correct: boolean;
}

export function EmojiCharades({ meIdentity, partnerIdentity, partnerName }: Props) {
  const { sendEvent, subscribe } = useRoomChannel();
  const [turn, setTurn] = useState(0);
  const [movieIdx, setMovieIdx] = useState(0);
  const [clue, setClue] = useState<string | null>(null);
  const [guesses, setGuesses] = useState<GuessLog[]>([]);
  const [revealed, setRevealed] = useState<"correct" | "given-up" | null>(null);

  // Local input state — not sync'd.
  const [emojiDraft, setEmojiDraft] = useState("");
  const [guessDraft, setGuessDraft] = useState("");

  const orderedIds = useMemo(
    () => [meIdentity, partnerIdentity].sort(),
    [meIdentity, partnerIdentity],
  );
  const clueGiver = orderedIds[turn % 2];
  const isClueGiver = clueGiver === meIdentity;

  const movie = getEmojiMovie(movieIdx);

  // Keep the send handlers `stale-closure`-safe by mirroring turn into a ref.
  const turnRef = useRef(turn);
  useEffect(() => {
    turnRef.current = turn;
  }, [turn]);

  useEffect(() => {
    const handler = (event: ChannelEvent) => {
      if (event.type !== "emojiCharades") return;

      if (event.phase === "reset") {
        setTurn(0);
        setMovieIdx(0);
        setClue(null);
        setGuesses([]);
        setRevealed(null);
        setEmojiDraft("");
        setGuessDraft("");
        return;
      }

      // Stale events from a prior round can't overwrite newer state.
      if ("turn" in event && event.turn < turnRef.current) return;

      if (event.phase === "clue") {
        setClue(event.emojis);
        setGuesses([]);
        setRevealed(null);
        return;
      }

      if (event.phase === "guess") {
        setGuesses((prev) => [...prev, { text: event.text, correct: false }]);
        return;
      }

      if (event.phase === "reveal") {
        setRevealed(event.correct ? "correct" : "given-up");
        // On a correct guess we append the winning guess for the log.
        // (Guesser already added it locally; clue-giver hasn't seen it yet
        // because the guesser sent `reveal`, not `guess`, on the win.)
        return;
      }

      if (event.phase === "next") {
        setTurn(event.nextTurn);
        setMovieIdx(event.nextMovieIdx);
        setClue(null);
        setGuesses([]);
        setRevealed(null);
        setEmojiDraft("");
        setGuessDraft("");
        return;
      }
    };
    return subscribe(handler);
  }, [subscribe]);

  const sendClue = useCallback(() => {
    if (!isClueGiver || clue !== null || emojiDraft.trim().length === 0) return;
    const emojis = emojiDraft.trim();
    setClue(emojis);
    setEmojiDraft("");
    void sendEvent({
      type: "emojiCharades",
      phase: "clue",
      turn,
      movieIdx,
      emojis,
    });
  }, [isClueGiver, clue, emojiDraft, turn, movieIdx, sendEvent]);

  const submitGuess = useCallback(() => {
    const text = guessDraft.trim();
    if (isClueGiver || clue === null || revealed !== null || !movie || text.length === 0) return;
    setGuessDraft("");
    if (isCorrectGuess(text, movie)) {
      setGuesses((prev) => [...prev, { text, correct: true }]);
      setRevealed("correct");
      void sendEvent({
        type: "emojiCharades",
        phase: "reveal",
        turn,
        correct: true,
      });
      return;
    }
    setGuesses((prev) => [...prev, { text, correct: false }]);
    void sendEvent({
      type: "emojiCharades",
      phase: "guess",
      turn,
      text,
    });
  }, [isClueGiver, clue, revealed, movie, guessDraft, turn, sendEvent]);

  const giveUp = useCallback(() => {
    if (!isClueGiver || clue === null || revealed !== null) return;
    setRevealed("given-up");
    void sendEvent({
      type: "emojiCharades",
      phase: "reveal",
      turn,
      correct: false,
    });
  }, [isClueGiver, clue, revealed, turn, sendEvent]);

  const nextRound = useCallback(() => {
    const nextTurn = turn + 1;
    const nextMovieIdx = (movieIdx + 1) % EMOJI_MOVIES.length;
    setTurn(nextTurn);
    setMovieIdx(nextMovieIdx);
    setClue(null);
    setGuesses([]);
    setRevealed(null);
    setEmojiDraft("");
    setGuessDraft("");
    void sendEvent({
      type: "emojiCharades",
      phase: "next",
      nextTurn,
      nextMovieIdx,
    });
  }, [turn, movieIdx, sendEvent]);

  const reset = useCallback(() => {
    setTurn(0);
    setMovieIdx(0);
    setClue(null);
    setGuesses([]);
    setRevealed(null);
    setEmojiDraft("");
    setGuessDraft("");
    void sendEvent({ type: "emojiCharades", phase: "reset" });
  }, [sendEvent]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between text-xs">
        <span className="rounded-full bg-fuchsia-100 px-2 py-1 font-mono font-semibold text-fuchsia-800">
          Round {turn + 1}
        </span>
        <div className="flex items-center gap-1">
          <span className="rounded-md bg-zinc-100 px-2 py-1 font-[family-name:var(--font-outfit)] text-zinc-700">
            {isClueGiver ? "You describe" : `${partnerName} describes`}
          </span>
          <button
            type="button"
            onClick={reset}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {isClueGiver ? (
          <ClueGiverView
            movieTitle={movie?.title ?? "(no movie)"}
            suggested={movie?.suggested}
            clue={clue}
            revealed={revealed}
            emojiDraft={emojiDraft}
            setEmojiDraft={setEmojiDraft}
            sendClue={sendClue}
            giveUp={giveUp}
            guesses={guesses}
            partnerName={partnerName}
          />
        ) : (
          <GuesserView
            movieTitle={movie?.title ?? "(no movie)"}
            clue={clue}
            revealed={revealed}
            guessDraft={guessDraft}
            setGuessDraft={setGuessDraft}
            submitGuess={submitGuess}
            guesses={guesses}
            partnerName={partnerName}
          />
        )}
      </div>

      {revealed && (
        <button
          type="button"
          onClick={nextRound}
          className="w-full rounded-lg bg-fuchsia-600 px-3 py-2.5 font-[family-name:var(--font-outfit)] text-sm font-semibold text-white shadow-sm transition hover:bg-fuchsia-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500"
        >
          Next round →
        </button>
      )}
    </div>
  );
}

// ---- Sub-views -----------------------------------------------------------

function ClueGiverView({
  movieTitle,
  suggested,
  clue,
  revealed,
  emojiDraft,
  setEmojiDraft,
  sendClue,
  giveUp,
  guesses,
  partnerName,
}: {
  movieTitle: string;
  suggested?: string;
  clue: string | null;
  revealed: "correct" | "given-up" | null;
  emojiDraft: string;
  setEmojiDraft: (v: string) => void;
  sendClue: () => void;
  giveUp: () => void;
  guesses: GuessLog[];
  partnerName: string;
}) {
  return (
    <>
      <div className="rounded-lg bg-fuchsia-50 p-3">
        <div className="text-[10px] font-semibold uppercase tracking-[1.5px] text-fuchsia-700">
          Your movie
        </div>
        <div className="mt-0.5 font-[family-name:var(--font-outfit)] text-lg font-semibold text-fuchsia-900">
          {movieTitle}
        </div>
      </div>

      {clue === null ? (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="font-[family-name:var(--font-outfit)] text-xs text-zinc-600">
              Describe it in emojis
            </label>
            <input
              type="text"
              value={emojiDraft}
              onChange={(e) => setEmojiDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendClue();
              }}
              placeholder={suggested ?? "🎬🍿"}
              maxLength={120}
              autoFocus
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-2xl focus:border-fuchsia-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-200"
            />
            {suggested && (
              <button
                type="button"
                onClick={() => setEmojiDraft(suggested)}
                className="self-start rounded-md px-2 py-1 text-[11px] font-medium text-fuchsia-700 transition hover:bg-fuchsia-50"
              >
                Use suggestion: {suggested}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={sendClue}
            disabled={emojiDraft.trim().length === 0}
            className="rounded-lg bg-fuchsia-600 px-3 py-2 font-[family-name:var(--font-outfit)] text-sm font-semibold text-white shadow-sm transition hover:bg-fuchsia-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            Send clue
          </button>
        </>
      ) : (
        <>
          <div className="rounded-lg bg-white p-3 text-center text-3xl leading-snug shadow-inner">
            {clue}
          </div>
          <GuessList guesses={guesses} partnerName={partnerName} />
          {revealed === null && (
            <button
              type="button"
              onClick={giveUp}
              className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-[family-name:var(--font-outfit)] text-sm font-medium text-amber-900 transition hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              Reveal answer
            </button>
          )}
        </>
      )}

      {revealed && (
        <RevealBanner
          kind={revealed}
          movieTitle={movieTitle}
          partnerName={partnerName}
          fromClueGiverPov
        />
      )}
    </>
  );
}

function GuesserView({
  movieTitle,
  clue,
  revealed,
  guessDraft,
  setGuessDraft,
  submitGuess,
  guesses,
  partnerName,
}: {
  movieTitle: string;
  clue: string | null;
  revealed: "correct" | "given-up" | null;
  guessDraft: string;
  setGuessDraft: (v: string) => void;
  submitGuess: () => void;
  guesses: GuessLog[];
  partnerName: string;
}) {
  if (clue === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white/60 px-4 text-center">
        <p className="font-[family-name:var(--font-outfit)] text-sm text-zinc-600">
          Waiting for {partnerName} to send a clue…
        </p>
      </div>
    );
  }
  return (
    <>
      <div className="rounded-lg bg-white p-4 text-center text-4xl leading-snug shadow-inner">
        {clue}
      </div>

      {revealed === null && (
        <div className="flex gap-2">
          <input
            type="text"
            value={guessDraft}
            onChange={(e) => setGuessDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitGuess();
            }}
            placeholder="Guess the movie…"
            maxLength={200}
            autoFocus
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-fuchsia-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-200"
          />
          <button
            type="button"
            onClick={submitGuess}
            disabled={guessDraft.trim().length === 0}
            className="rounded-lg bg-fuchsia-600 px-3 py-2 font-[family-name:var(--font-outfit)] text-sm font-semibold text-white shadow-sm transition hover:bg-fuchsia-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            Guess
          </button>
        </div>
      )}

      <GuessList guesses={guesses} partnerName={partnerName} guesserPov />

      {revealed && (
        <RevealBanner
          kind={revealed}
          movieTitle={movieTitle}
          partnerName={partnerName}
        />
      )}
    </>
  );
}

function GuessList({
  guesses,
  partnerName,
  guesserPov,
}: {
  guesses: GuessLog[];
  partnerName: string;
  guesserPov?: boolean;
}) {
  if (guesses.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] font-semibold uppercase tracking-[1.5px] text-zinc-500">
        {guesserPov ? "Your guesses" : `${partnerName}'s guesses`}
      </div>
      <ul className="flex flex-col gap-1">
        {guesses.map((g, i) => (
          <li
            key={i}
            className={
              "rounded-md px-2 py-1 font-[family-name:var(--font-outfit)] text-xs " +
              (g.correct
                ? "bg-emerald-50 text-emerald-800"
                : "bg-zinc-100 text-zinc-700")
            }
          >
            {g.correct ? "✓ " : "✗ "}
            {g.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RevealBanner({
  kind,
  movieTitle,
  partnerName,
  fromClueGiverPov,
}: {
  kind: "correct" | "given-up";
  movieTitle: string;
  partnerName: string;
  fromClueGiverPov?: boolean;
}) {
  if (kind === "correct") {
    return (
      <div className="rounded-lg bg-emerald-50 p-3 text-center">
        <div className="text-2xl">🎉</div>
        <p className="mt-1 font-[family-name:var(--font-outfit)] text-sm font-semibold text-emerald-900">
          {fromClueGiverPov ? `${partnerName} got it!` : "You got it!"}
        </p>
        <p className="text-xs text-emerald-800">{movieTitle}</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-amber-50 p-3 text-center">
      <div className="text-2xl">🙈</div>
      <p className="mt-1 font-[family-name:var(--font-outfit)] text-sm font-semibold text-amber-900">
        Revealed
      </p>
      <p className="text-xs text-amber-800">{movieTitle}</p>
    </div>
  );
}

// ---- Panel wrapper -------------------------------------------------------

export function EmojiCharadesPanel({ room }: { room: Room }) {
  const me = room.localParticipant;
  const partner = [...room.remoteParticipants.values()][0];
  if (!partner) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white/60 p-4 text-center">
        <p className="font-[family-name:var(--font-outfit)] text-sm text-zinc-600">
          Emoji Charades needs two players. Waiting for someone to join…
        </p>
      </div>
    );
  }
  return (
    <EmojiCharades
      meIdentity={me.identity}
      partnerIdentity={partner.identity}
      partnerName={partner.name ?? "your partner"}
    />
  );
}
