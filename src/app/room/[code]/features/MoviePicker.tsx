"use client";

/**
 * Movie Picker — "what should we watch tonight?" wizard.
 *
 * Three steps, synced across both peers via `moviePicker` envelope events:
 *   0. GENRE  — pick a shared mood/genre
 *   1. PICK   — each partner searches TMDB and adds their top 3
 *   2. REVEAL — animated shuffle → tonight's pick
 *
 * State model: local per-peer, driven by subscribe. Both sides see the same
 * event stream (RELIABLE) so their local state converges. Late-join within a
 * running picker is not hydrated — hit Reset to resync. (Matches Truth or
 * Dare posture; hydration would need a moviePicker snapshot slot in
 * `hello.snapshot`, deferred until we ship an actual retention need for it.)
 *
 * Accent: soft indigo (`#e0e7ff` → Tailwind `indigo-100`) used as the
 * secondary accent per product ask 2026-09-06 — planning-together vibe.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Room } from "livekit-client";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import type { RoomEvent as ChannelEvent } from "@/lib/room/envelope";

// ---- Constants -----------------------------------------------------------

/** Default picks per person. Couples can bump this up or down via the
 *  header control; the choice syncs to the partner via `picks-per-person`. */
const DEFAULT_PICKS_PER_PERSON = 3;
const MIN_PICKS_PER_PERSON = 1;
const MAX_PICKS_PER_PERSON = 10;

interface PickerMovie {
  id: number;
  title: string;
  posterPath: string | null;
  releaseDate?: string | null;
}

/** Special activeGameId used to render the picker inside the games panel.
 *  Not a real entry in `src/lib/games.ts` — the tile grid never shows this;
 *  it's only reachable via the action-bar button (or a peer opening it). */
export const MOVIE_PICKER_GAME_ID = "movie-picker";

/**
 * Action-bar entry point. Uses the same `game.open` sync path the tile grid
 * uses so the picker lands in the right-column games panel instead of
 * hijacking the whole screen — otherwise, whoever is searching a movie
 * would block the other from using games. Sender identity travels with the
 * open event so downstream components can gate owner-only steps (genre).
 */
export function MoviePickerButton({ room }: { room: Room | null }) {
  const { roomState, sendEvent } = useRoomChannel();
  const active = roomState.activeGameId === MOVIE_PICKER_GAME_ID;

  const openPicker = () => {
    if (!room) return;
    void sendEvent({
      type: "game",
      phase: "open",
      id: MOVIE_PICKER_GAME_ID,
      by: room.localParticipant.identity,
    });
  };

  return (
    <button
      type="button"
      onClick={openPicker}
      disabled={active}
      title={
        active
          ? "Movie picker is open in the couple-games panel."
          : "Pick tonight's movie together"
      }
      className={
        "flex h-[45px] items-center justify-center gap-2 rounded-lg border px-6 font-[family-name:var(--font-outfit)] text-sm font-medium shadow-sm backdrop-blur transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 " +
        (active
          ? "cursor-not-allowed border-indigo-300 bg-indigo-200 text-indigo-900 opacity-70"
          : "border-indigo-200 bg-indigo-50 text-indigo-900 hover:bg-indigo-100")
      }
    >
      <span aria-hidden>🎞️</span>
      Movie pick
    </button>
  );
}

// ---- Modal (multi-step wizard) ------------------------------------------

interface Props {
  room: Room;
  onClose: () => void;
}

export function MoviePicker({ room, onClose }: Props) {
  const { sendEvent, subscribe } = useRoomChannel();
  const meId = room.localParticipant.identity;
  const meName = room.localParticipant.name || "You";
  const partner = [...room.remoteParticipants.values()][0];
  const partnerName = partner?.name || "Your partner";

  const [step, setStep] = useState(0);
  const [myPicks, setMyPicks] = useState<PickerMovie[]>([]);
  const [partnerPicks, setPartnerPicks] = useState<PickerMovie[]>([]);
  const [shuffleWinnerId, setShuffleWinnerId] = useState<number | null>(null);
  const [picksPerPerson, setPicksPerPerson] = useState(DEFAULT_PICKS_PER_PERSON);

  // ---- Inbound event handling -------------------------------------------

  useEffect(() => {
    const handler = (event: ChannelEvent, from: string) => {
      if (event.type !== "moviePicker") return;
      switch (event.phase) {
        case "step":
          setStep(event.step);
          return;
        case "add": {
          const m: PickerMovie = event.movie;
          if (event.by === meId) {
            setMyPicks((prev) =>
              prev.some((x) => x.id === m.id) ? prev : [...prev, m],
            );
          } else {
            setPartnerPicks((prev) =>
              prev.some((x) => x.id === m.id) ? prev : [...prev, m],
            );
          }
          return;
        }
        case "remove":
          if (event.by === meId) {
            setMyPicks((prev) => prev.filter((x) => x.id !== event.movieId));
          } else {
            setPartnerPicks((prev) => prev.filter((x) => x.id !== event.movieId));
          }
          return;
        case "shuffle-result":
          setShuffleWinnerId(event.movieId);
          return;
        case "reset":
          setStep(0);
          setMyPicks([]);
          setPartnerPicks([]);
          setShuffleWinnerId(null);
          return;
        case "picks-per-person": {
          // Trim any picks over the new cap so both peers converge to the
          // same list length. Bumping the cap up leaves existing picks alone.
          const n = Math.min(
            MAX_PICKS_PER_PERSON,
            Math.max(MIN_PICKS_PER_PERSON, event.count),
          );
          setPicksPerPerson(n);
          setMyPicks((prev) => prev.slice(0, n));
          setPartnerPicks((prev) => prev.slice(0, n));
          return;
        }
        default:
          return;
      }
      void from;
    };
    return subscribe(handler);
  }, [subscribe, meId]);

  // ---- Actions -----------------------------------------------------------

  const goToStep = (next: number) => {
    setStep(next);
    void sendEvent({ type: "moviePicker", phase: "step", step: next });
  };
  const addPick = (m: PickerMovie) => {
    if (myPicks.length >= picksPerPerson) return;
    if (myPicks.some((x) => x.id === m.id)) return;
    setMyPicks((prev) => [...prev, m]);
    void sendEvent({
      type: "moviePicker",
      phase: "add",
      by: meId,
      movie: m,
    });
  };
  const removeMyPick = (id: number) => {
    setMyPicks((prev) => prev.filter((x) => x.id !== id));
    void sendEvent({
      type: "moviePicker",
      phase: "remove",
      by: meId,
      movieId: id,
    });
  };
  const reset = () => {
    void sendEvent({ type: "moviePicker", phase: "reset" });
    setStep(0);
    setMyPicks([]);
    setPartnerPicks([]);
    setShuffleWinnerId(null);
  };
  const changePicksPerPerson = (n: number) => {
    const clamped = Math.min(
      MAX_PICKS_PER_PERSON,
      Math.max(MIN_PICKS_PER_PERSON, n),
    );
    if (clamped === picksPerPerson) return;
    setPicksPerPerson(clamped);
    setMyPicks((prev) => prev.slice(0, clamped));
    setPartnerPicks((prev) => prev.slice(0, clamped));
    void sendEvent({
      type: "moviePicker",
      phase: "picks-per-person",
      count: clamped,
    });
  };

  // Reveal step gets both lists combined into one shuffle pool.
  const pool = useMemo(
    () => [...myPicks, ...partnerPicks],
    [myPicks, partnerPicks],
  );

  const bothReady = myPicks.length === picksPerPerson && partnerPicks.length === picksPerPerson;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Header — a compact bar since we're inside the games panel now,
          not a full-screen modal. Restart + Close controls stay in the
          same layout position users expect from the games back-button. */}
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-base">
          🎞️
        </span>
        <h2 className="flex-1 font-[family-name:var(--font-outfit)] text-sm font-semibold text-zinc-900">
          Tonight's movie
        </h2>
        <button
          type="button"
          onClick={reset}
          className="rounded-md px-2 py-1 text-[10px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          Restart
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close movie picker"
          className="flex size-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <span aria-hidden className="text-base leading-none">
            ×
          </span>
        </button>
      </div>

      {/* Stepper — just two steps now. Genre step was cut 2026-09-06. */}
      <div className="flex items-center gap-1.5">
        {["Pick", "Reveal"].map((label, i) => (
          <div
            key={label}
            className={
              "flex flex-1 items-center gap-1 rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-[1px] transition " +
              (i === step
                ? "bg-indigo-100 text-indigo-900"
                : i < step
                  ? "bg-indigo-50 text-indigo-600"
                  : "bg-zinc-100 text-zinc-500")
            }
          >
            <span>{i + 1}</span>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {step === 0 && (
          <PickStep
            myPicks={myPicks}
            partnerPicks={partnerPicks}
            partnerName={partnerName}
            meName={meName}
            onAdd={addPick}
            onRemove={removeMyPick}
            onNext={() => goToStep(1)}
            bothReady={bothReady}
            picksPerPerson={picksPerPerson}
            onChangePicksPerPerson={changePicksPerPerson}
          />
        )}
        {step === 1 && (
          <RevealStep
            pool={pool}
            winnerId={shuffleWinnerId}
            picksPerPerson={picksPerPerson}
            onShuffle={() => {
              if (pool.length === 0) return;
              const winner = pool[Math.floor(Math.random() * pool.length)]!;
              void sendEvent({
                type: "moviePicker",
                phase: "shuffle-result",
                movieId: winner.id,
              });
            }}
          />
        )}
      </div>
    </div>
  );
}

// ---- Step 0: Pick 3 ------------------------------------------------------

function PickStep({
  myPicks,
  partnerPicks,
  partnerName,
  meName,
  onAdd,
  onRemove,
  onNext,
  bothReady,
  picksPerPerson,
  onChangePicksPerPerson,
}: {
  myPicks: PickerMovie[];
  partnerPicks: PickerMovie[];
  partnerName: string;
  meName: string;
  onAdd: (m: PickerMovie) => void;
  onRemove: (id: number) => void;
  onNext: () => void;
  bothReady: boolean;
  picksPerPerson: number;
  onChangePicksPerPerson: (n: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerMovie[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced search — hits /api/movies/search with the current query.
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    const t = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/movies/search?query=${encodeURIComponent(query)}`;
        const res = await fetch(url);
        if (!res.ok) {
          setError("Couldn't reach the movie service. Try again.");
          setResults([]);
        } else {
          const data = (await res.json()) as {
            results: {
              id: number;
              title: string;
              poster_path: string | null;
              release_date?: string | null;
            }[];
          };
          setResults(
            data.results.slice(0, 10).map((m) => ({
              id: m.id,
              title: m.title,
              posterPath: m.poster_path,
              releaseDate: m.release_date ?? null,
            })),
          );
        }
      } catch {
        setError("Network error. Try again.");
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [query]);

  return (
    <StepFrame
      title={`Your top ${picksPerPerson} movie${picksPerPerson === 1 ? "" : "s"}`}
      subtitle={`Search and tap to add. Both of you need ${picksPerPerson}.`}
      footer={
        <div className="flex items-center gap-2">
          <ProgressPill
            label={meName}
            done={myPicks.length}
            total={picksPerPerson}
          />
          <ProgressPill
            label={partnerName}
            done={partnerPicks.length}
            total={picksPerPerson}
          />
          <button
            type="button"
            disabled={!bothReady}
            onClick={onNext}
            className="ml-auto rounded-lg bg-indigo-600 px-4 py-2.5 font-[family-name:var(--font-outfit)] text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {bothReady ? "Shuffle 🎲" : "Waiting…"}
          </button>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Picks-per-person selector — synced across peers so both see the
            same number of slots and progress denominators. */}
        <PicksPerPersonPicker
          value={picksPerPerson}
          onChange={onChangePicksPerPerson}
        />

        {/* My picks strip */}
        <MyPicksStrip
          picks={myPicks}
          onRemove={onRemove}
          picksPerPerson={picksPerPerson}
        />

        {/* Search input */}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search movies…"
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-[family-name:var(--font-outfit)] text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        />

        {/* Results */}
        <div className="flex-1 overflow-y-auto rounded-lg border border-zinc-100 bg-indigo-50/30">
          {loading && (
            <p className="p-4 text-center text-xs text-zinc-500">Searching…</p>
          )}
          {!loading && error && (
            <p className="p-4 text-center text-xs text-red-600">{error}</p>
          )}
          {!loading && !error && results.length === 0 && query.trim() && (
            <p className="p-4 text-center text-xs text-zinc-500">
              No matches.
            </p>
          )}
          {!loading && !error && !query.trim() && (
            <p className="p-4 text-center text-xs text-zinc-500">
              Type a movie title to start searching.
            </p>
          )}
          {results.map((m) => {
            const already = myPicks.some((x) => x.id === m.id);
            const partnerHas = partnerPicks.some((x) => x.id === m.id);
            const disabled = already || myPicks.length >= picksPerPerson;
            return (
              <button
                key={m.id}
                type="button"
                disabled={disabled}
                onClick={() => onAdd(m)}
                className={
                  "flex w-full items-center gap-3 border-b border-zinc-100 px-3 py-2 text-left transition last:border-b-0 " +
                  (disabled
                    ? "cursor-not-allowed opacity-60"
                    : "hover:bg-indigo-100/50")
                }
              >
                {m.posterPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt=""
                    src={`https://image.tmdb.org/t/p/w185${m.posterPath}`}
                    className="h-14 w-10 rounded-md object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-10 items-center justify-center rounded-md bg-zinc-200 text-xs text-zinc-500">
                    ?
                  </div>
                )}
                <div className="flex-1">
                  <p className="font-[family-name:var(--font-outfit)] text-sm font-medium text-zinc-900">
                    {m.title}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {m.releaseDate?.slice(0, 4) ?? "—"}
                    {partnerHas && (
                      <span className="ml-2 text-indigo-600">
                        · also on {partnerName}&apos;s list
                      </span>
                    )}
                  </p>
                </div>
                {already ? (
                  <span className="text-xs font-semibold text-emerald-600">
                    Added
                  </span>
                ) : (
                  <span className="text-xs text-indigo-600">+ Add</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </StepFrame>
  );
}

function MyPicksStrip({
  picks,
  onRemove,
  picksPerPerson,
}: {
  picks: PickerMovie[];
  onRemove: (id: number) => void;
  picksPerPerson: number;
}) {
  const slots = Array.from({ length: picksPerPerson });
  return (
    <div className="flex gap-2">
      {slots.map((_, i) => {
        const p = picks[i];
        return (
          <div
            key={i}
            className={
              "relative flex aspect-[2/3] flex-1 items-center justify-center overflow-hidden rounded-lg border-2 text-center transition " +
              (p ? "border-indigo-400" : "border-dashed border-zinc-300 bg-zinc-50")
            }
          >
            {p ? (
              <>
                {p.posterPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={p.title}
                    src={`https://image.tmdb.org/t/p/w185${p.posterPath}`}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <span className="p-2 text-[10px] leading-tight text-zinc-500">
                    {p.title}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(p.id)}
                  aria-label={`Remove ${p.title}`}
                  className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-[10px] text-white backdrop-blur transition hover:bg-black/80"
                >
                  ×
                </button>
              </>
            ) : (
              <span className="text-2xl text-zinc-300">+</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PicksPerPersonPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-2 py-1.5">
      <span className="font-[family-name:var(--font-outfit)] text-[11px] font-medium text-indigo-900">
        Movies each
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(value - 1)}
          disabled={value <= MIN_PICKS_PER_PERSON}
          aria-label="Fewer picks"
          className="flex size-6 items-center justify-center rounded-md border border-indigo-200 bg-white text-sm font-semibold text-indigo-800 transition hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          −
        </button>
        <span className="min-w-[1.5rem] text-center font-mono text-sm font-bold text-indigo-900">
          {value}
        </span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          disabled={value >= MAX_PICKS_PER_PERSON}
          aria-label="More picks"
          className="flex size-6 items-center justify-center rounded-md border border-indigo-200 bg-white text-sm font-semibold text-indigo-800 transition hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          +
        </button>
      </div>
      <span className="ml-auto text-[10px] text-indigo-700">
        {MIN_PICKS_PER_PERSON}–{MAX_PICKS_PER_PERSON} · syncs to partner
      </span>
    </div>
  );
}

function ProgressPill({
  label,
  done,
  total,
}: {
  label: string;
  done: number;
  total: number;
}) {
  const full = done === total;
  return (
    <div
      className={
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium " +
        (full ? "bg-emerald-100 text-emerald-800" : "bg-indigo-50 text-indigo-700")
      }
    >
      <span>{label}</span>
      <span className="font-mono">
        {done}/{total}
      </span>
    </div>
  );
}

// ---- Step 2: Reveal ------------------------------------------------------

function RevealStep({
  pool,
  winnerId,
  picksPerPerson,
  onShuffle,
}: {
  pool: PickerMovie[];
  winnerId: number | null;
  picksPerPerson: number;
  onShuffle: () => void;
}) {
  const [cyclingIdx, setCyclingIdx] = useState<number | null>(null);
  const cycleTimerRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);

  // Slot-machine cycle when a shuffle is triggered locally (winnerId change).
  useEffect(() => {
    if (winnerId === null || pool.length === 0) return;
    setCyclingIdx(0);
    let i = 0;
    // Fast cycle for ~1.6s, slowing down at the end, then land on winner.
    cycleTimerRef.current = window.setInterval(() => {
      i = (i + 1) % pool.length;
      setCyclingIdx(i);
    }, 90);
    stopTimerRef.current = window.setTimeout(() => {
      if (cycleTimerRef.current !== null) {
        window.clearInterval(cycleTimerRef.current);
        cycleTimerRef.current = null;
      }
      const winnerIndex = pool.findIndex((p) => p.id === winnerId);
      setCyclingIdx(winnerIndex >= 0 ? winnerIndex : 0);
    }, 1800);

    return () => {
      if (cycleTimerRef.current !== null)
        window.clearInterval(cycleTimerRef.current);
      if (stopTimerRef.current !== null)
        window.clearTimeout(stopTimerRef.current);
    };
  }, [winnerId, pool]);

  const displayed =
    cyclingIdx !== null && pool[cyclingIdx]
      ? pool[cyclingIdx]
      : winnerId !== null
        ? pool.find((p) => p.id === winnerId) ?? null
        : null;

  const shuffled = winnerId !== null;

  const poolTotal = picksPerPerson * 2;
  return (
    <StepFrame
      title={`${poolTotal} movie${poolTotal === 1 ? "" : "s"}. One winner.`}
      subtitle="Whoever hits shuffle first triggers it for both."
      footer={
        <button
          type="button"
          onClick={onShuffle}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-[family-name:var(--font-outfit)] text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {shuffled ? "Reshuffle 🎲" : "Shuffle 🎲"}
        </button>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Pool thumbnails — column count follows the pool size so 2, 4,
            6, 8… all lay out cleanly at any picks-per-person setting. */}
        <div
          className="grid gap-1.5"
          style={{
            gridTemplateColumns: `repeat(${Math.max(2, Math.min(poolTotal, 10))}, minmax(0, 1fr))`,
          }}
        >
          {pool.map((m, i) => (
            <div
              key={m.id}
              className={
                "relative aspect-[2/3] overflow-hidden rounded-md border-2 transition " +
                (cyclingIdx === i
                  ? "border-indigo-500 scale-105 shadow-md"
                  : "border-transparent opacity-60")
              }
            >
              {m.posterPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  src={`https://image.tmdb.org/t/p/w185${m.posterPath}`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-zinc-200 text-[9px] text-zinc-500">
                  {m.title.slice(0, 6)}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Winner card */}
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl bg-indigo-100/60 p-4">
          {displayed ? (
            <div className="flex flex-col items-center gap-2 text-center">
              {displayed.posterPath && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={displayed.title}
                  src={`https://image.tmdb.org/t/p/w342${displayed.posterPath}`}
                  className="h-40 w-auto rounded-lg shadow-md"
                />
              )}
              <p className="font-[family-name:var(--font-outfit)] text-[11px] uppercase tracking-[1.5px] text-indigo-700">
                {cyclingIdx !== null && !stopTimerElapsed(cycleTimerRef, stopTimerRef)
                  ? "Shuffling…"
                  : "Tonight you're watching"}
              </p>
              <p className="font-[family-name:var(--font-outfit)] text-lg font-bold text-indigo-900">
                {displayed.title}
              </p>
              {displayed.releaseDate && (
                <p className="text-xs text-zinc-500">
                  {displayed.releaseDate.slice(0, 4)}
                </p>
              )}
            </div>
          ) : (
            <p className="font-[family-name:var(--font-outfit)] text-sm text-zinc-500">
              Hit shuffle to reveal the pick.
            </p>
          )}
        </div>
      </div>
    </StepFrame>
  );
}

/** Small ref-check helper — the shuffle animation label needs to know
 *  whether we're still cycling or landed. */
function stopTimerElapsed(
  cycleRef: React.RefObject<number | null>,
  _stopRef: React.RefObject<number | null>,
): boolean {
  return cycleRef.current === null;
}

// ---- Layout helper -------------------------------------------------------

function StepFrame({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h3 className="font-[family-name:var(--font-outfit)] text-base font-semibold text-zinc-900">
          {title}
        </h3>
        {subtitle && (
          <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
      <div className="pt-1">{footer}</div>
    </div>
  );
}
