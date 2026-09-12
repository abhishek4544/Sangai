"use client";

/**
 * Most Likely To — arcade-styled couples "point at whoever fits" game.
 *
 * Wire model: each peer sends `target: "me" | "partner"` from their own POV.
 * At render time the receiver flips the interpretation: my `target === "me"`
 * means the sender pointed at themselves, so on the receiver's screen that
 * lands on the *partner* button. Cleanest way to avoid ambiguity — every
 * event is self-referential and correct no matter who reads it.
 *
 * Match logic:
 *   - Both peers pointed at the same actual person → "in agreement".
 *   - They pointed at different people → "split call".
 * Both scenarios reveal identically; only the label differs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Room } from "livekit-client";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import type { RoomEvent as ChannelEvent } from "@/lib/room/envelope";
import { getMLTPrompt, MLT_DECK_LENGTH } from "@/lib/games/most-likely-to";
import { getWeekSeed } from "@/lib/games/shuffle";

/** Actual person referenced, in the shared frame of the room. */
type Actual = "me" | "partner";
/** Sender-POV target as it appears on the wire. */
type Target = "me" | "partner";

interface Props {
  meIdentity: string;
  partnerIdentity: string;
  myName: string;
  partnerName: string;
}

interface RoundPoints {
  /** Who I pointed at, in my own frame. */
  me: Actual | null;
  /** Who my partner pointed at, translated into my frame. */
  partner: Actual | null;
}

/**
 * Translate a sender's POV `target` into the receiver's frame.
 *
 * If the sender pointed at "me", from the receiver's perspective that's
 * their partner; if the sender pointed at their partner, that's the
 * receiver themselves. Same rule from either end.
 */
function toReceiverFrame(target: Target): Actual {
  return target === "me" ? "partner" : "me";
}

export function MostLikelyTo({
  meIdentity,
  partnerIdentity,
  myName,
  partnerName,
}: Props) {
  const { sendEvent, subscribe } = useRoomChannel();
  const [roundIdx, setRoundIdx] = useState(0);
  const [points, setPoints] = useState<RoundPoints>({ me: null, partner: null });
  const [score, setScore] = useState({ agreed: 0, played: 0 });
  const countedRoundsRef = useRef<Set<number>>(new Set());
  const [revealed, setRevealed] = useState(false);

  const weekSeed = useMemo(() => getWeekSeed(), []);
  const prompt = useMemo(
    () => getMLTPrompt(roundIdx, weekSeed),
    [roundIdx, weekSeed],
  );

  const bothIn = points.me !== null && points.partner !== null;
  const agreed = bothIn && points.me === points.partner;

  useEffect(() => {
    if (bothIn && !countedRoundsRef.current.has(roundIdx)) {
      countedRoundsRef.current.add(roundIdx);
      setScore((s) => ({
        agreed: s.agreed + (points.me === points.partner ? 1 : 0),
        played: s.played + 1,
      }));
      setRevealed(true);
    }
  }, [bothIn, roundIdx, points.me, points.partner]);

  useEffect(() => {
    const handler = (event: ChannelEvent) => {
      if (event.type !== "mostLikelyTo") return;
      if (event.phase === "reset") {
        setRoundIdx(0);
        setPoints({ me: null, partner: null });
        setScore({ agreed: 0, played: 0 });
        countedRoundsRef.current = new Set();
        setRevealed(false);
        return;
      }
      if (event.phase === "next") {
        if (event.nextIdx <= roundIdx) return;
        setRoundIdx(event.nextIdx);
        setPoints({ me: null, partner: null });
        setRevealed(false);
        return;
      }
      if (event.phase === "point") {
        if (event.roundIdx !== roundIdx) return;
        setPoints((prev) => {
          if (event.by === meIdentity) {
            // Echo of my own send — record in my frame directly.
            return { ...prev, me: event.target };
          }
          if (event.by === partnerIdentity) {
            return { ...prev, partner: toReceiverFrame(event.target) };
          }
          return prev;
        });
        return;
      }
    };
    return subscribe(handler);
  }, [subscribe, roundIdx, meIdentity, partnerIdentity]);

  const point = useCallback(
    (at: Actual) => {
      if (points.me !== null) return;
      setPoints((prev) => ({ ...prev, me: at }));
      // Wire `target` is sender-POV; my `at === "me"` means I pointed at
      // myself, so the wire carries "me". Partner will flip it on receive.
      void sendEvent({
        type: "mostLikelyTo",
        phase: "point",
        roundIdx,
        target: at,
        by: meIdentity,
      });
    },
    [points.me, roundIdx, meIdentity, sendEvent],
  );

  const nextRound = useCallback(() => {
    void sendEvent({
      type: "mostLikelyTo",
      phase: "next",
      nextIdx: roundIdx + 1,
    });
  }, [roundIdx, sendEvent]);

  const reset = useCallback(() => {
    void sendEvent({ type: "mostLikelyTo", phase: "reset" });
  }, [sendEvent]);

  const roundNumber = (roundIdx % MLT_DECK_LENGTH) + 1;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-xl">
      {/* Backdrop — warm regal glow, distinct from WYR (pink/cyan) and NHIE (violet). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1000px 260px at 50% 0%, rgba(250,204,21,0.22), transparent 60%), radial-gradient(900px 260px at 50% 100%, rgba(244,63,94,0.18), transparent 60%), linear-gradient(180deg, #fffbeb 0%, #fef3c7 100%)",
        }}
      />

      {/* HUD */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-white/85 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[10px] font-semibold uppercase tracking-[1.5px] text-zinc-600 shadow-sm ring-1 ring-black/5">
            Round {roundNumber}
          </span>
          <span className="rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-2 py-0.5 font-[family-name:var(--font-outfit)] text-[10px] font-semibold uppercase tracking-[1.5px] text-white shadow-sm">
            {score.agreed}/{score.played} agreed
          </span>
        </div>
        <button
          type="button"
          onClick={reset}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          New game
        </button>
      </div>

      {/* Prompt card */}
      <div
        className="relative flex min-h-[120px] flex-col justify-center overflow-hidden rounded-2xl p-5 text-white shadow-xl"
        style={{
          background:
            "linear-gradient(135deg, #b45309 0%, #d97706 45%, #f59e0b 100%)",
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -right-3 -top-4 text-[110px] leading-none opacity-15"
        >
          {prompt.flavor ?? "👑"}
        </span>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(500px 120px at 40% 0%, rgba(255,255,255,0.22), transparent 60%)",
          }}
        />
        <div className="relative z-10 flex flex-col gap-1.5">
          <span className="font-[family-name:var(--font-outfit)] text-[10px] font-bold uppercase tracking-[3px] text-white/80">
            Most likely to…
          </span>
          <p className="font-[family-name:var(--font-outfit)] text-xl font-bold leading-tight text-white drop-shadow-sm sm:text-2xl">
            {prompt.text}
          </p>
        </div>
      </div>

      {/* Point-at buttons — one per person */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
        <PointButton
          target="me"
          name={myName}
          initial={myName.charAt(0).toUpperCase()}
          disabled={points.me !== null}
          selectedByMe={points.me === "me"}
          selectedByPartner={points.partner === "me"}
          revealed={revealed}
          isAgreement={agreed && points.me === "me"}
          onClick={() => point("me")}
        />
        <PointButton
          target="partner"
          name={partnerName}
          initial={partnerName.charAt(0).toUpperCase()}
          disabled={points.me !== null}
          selectedByMe={points.me === "partner"}
          selectedByPartner={points.partner === "partner"}
          revealed={revealed}
          isAgreement={agreed && points.me === "partner"}
          onClick={() => point("partner")}
        />
      </div>

      {/* Footer */}
      <div className="min-h-[38px]">
        {!bothIn && points.me === null && (
          <p className="text-center font-[family-name:var(--font-outfit)] text-[12px] text-zinc-500">
            Point at whoever fits. Reveal together.
          </p>
        )}
        {!bothIn && points.me !== null && (
          <div className="flex items-center justify-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-70" />
              <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
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
                (agreed
                  ? "bg-gradient-to-r from-emerald-400 to-teal-500 text-white"
                  : "bg-gradient-to-r from-rose-400 to-fuchsia-500 text-white")
              }
            >
              {agreed ? "You agree 👑" : "Split call 🤨"}
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

interface PointButtonProps {
  target: Actual;
  name: string;
  initial: string;
  disabled: boolean;
  selectedByMe: boolean;
  selectedByPartner: boolean;
  revealed: boolean;
  isAgreement: boolean;
  onClick: () => void;
}

function PointButton({
  target,
  name,
  initial,
  disabled,
  selectedByMe,
  selectedByPartner,
  revealed,
  isAgreement,
  onClick,
}: PointButtonProps) {
  const palette =
    target === "me"
      ? {
          bg: "linear-gradient(135deg, #f59e0b 0%, #fb923c 100%)",
          glow: "0 18px 34px -12px rgba(245, 158, 11, 0.55)",
          matchRing: "ring-amber-300",
        }
      : {
          bg: "linear-gradient(135deg, #ef4444 0%, #ec4899 100%)",
          glow: "0 18px 34px -12px rgba(236, 72, 153, 0.55)",
          matchRing: "ring-rose-300",
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
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(400px 100px at 50% -20%, rgba(255,255,255,0.35), transparent 60%)",
        }}
      />
      {isAgreement && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-pulse"
          style={{
            background:
              "radial-gradient(300px 160px at 50% 50%, rgba(255,255,255,0.35), transparent 70%)",
          }}
        />
      )}

      <span className="relative z-10 flex size-12 items-center justify-center rounded-full bg-white/25 font-[family-name:var(--font-outfit)] text-xl font-black text-white backdrop-blur">
        {initial}
      </span>
      <span className="relative z-10 max-w-full truncate font-[family-name:var(--font-outfit)] text-base font-bold text-white drop-shadow-sm">
        {name}
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

export function MostLikelyToPanel({ room }: { room: Room }) {
  const me = room.localParticipant;
  const partner = [...room.remoteParticipants.values()][0];
  if (!partner) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white/60 p-4 text-center">
        <p className="font-[family-name:var(--font-outfit)] text-sm text-zinc-600">
          Most Likely To needs two players. Waiting for someone to join…
        </p>
      </div>
    );
  }
  return (
    <MostLikelyTo
      meIdentity={me.identity}
      partnerIdentity={partner.identity}
      myName={me.name ?? "You"}
      partnerName={partner.name ?? "your partner"}
    />
  );
}
