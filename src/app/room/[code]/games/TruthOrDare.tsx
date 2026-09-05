"use client";

/**
 * Truth or Dare game — first playable Couple Game.
 *
 * Sync model: no roomState field. Both peers derive local state from the
 * ordered TruthOrDare event stream (subscribe from `useRoomChannel`). Whose
 * turn it is: sorted participant identities → index by `turn % 2`. That's
 * deterministic on both sides without coordination.
 *
 * Late-join / refresh caveat: whoever missed the events sees turn 0 with no
 * card. Both partners can hit "New game" to resync (reset event).
 */

import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Room } from "livekit-client";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import type { RoomEvent as ChannelEvent } from "@/lib/room/envelope";
import { getTodCard, pickRandomTod, type TodType } from "@/lib/games/truth-or-dare";

// We can't import RoomContext directly (it's defined in RoomClient.tsx as a
// module-local const), so we accept `room` via a small wrapper below. Cleaner
// pass-through: parent (`GamesPanel`) reads useRoom and forwards it.

interface CurrentCard {
  type: TodType;
  id: string;
  text: string;
}

interface Props {
  /** Local participant identity — used to compute isMyTurn. */
  meIdentity: string;
  /** Partner identity — sorted with `meIdentity` to compute turn order. */
  partnerIdentity: string;
  /** Partner's display name for the "Waiting for …" state. */
  partnerName: string;
}

export function TruthOrDare({ meIdentity, partnerIdentity, partnerName }: Props) {
  const { sendEvent, subscribe } = useRoomChannel();
  const [turn, setTurn] = useState(0);
  const [card, setCard] = useState<CurrentCard | null>(null);

  // Deterministic turn ordering — sort identities so both peers agree.
  const orderedIds = useMemo(
    () => [meIdentity, partnerIdentity].sort(),
    [meIdentity, partnerIdentity],
  );
  const currentPlayer = orderedIds[turn % 2];
  const isMyTurn = currentPlayer === meIdentity;

  useEffect(() => {
    const handler = (event: ChannelEvent) => {
      if (event.type !== "truthOrDare") return;
      if (event.phase === "reset") {
        setTurn(0);
        setCard(null);
        return;
      }
      if (event.phase === "pick") {
        // Only apply if the event is for the current turn; a stale pick
        // (network reorder) can't overwrite a newer state.
        if (event.turn < turn) return;
        const looked = getTodCard(event.cardId);
        setCard({
          type: event.cardType,
          id: event.cardId,
          text: looked?.text ?? "(A card your version doesn't recognise — hit Next.)",
        });
        setTurn(event.turn);
        return;
      }
      if (event.phase === "pass") {
        if (event.turn < turn) return;
        setTurn(event.turn + 1);
        setCard(null);
        return;
      }
    };
    return subscribe(handler);
  }, [subscribe, turn]);

  const pick = useCallback(
    (type: TodType) => {
      if (!isMyTurn) return;
      const drawn = pickRandomTod(type, card?.id ?? null);
      void sendEvent({
        type: "truthOrDare",
        phase: "pick",
        turn,
        cardType: drawn.type,
        cardId: drawn.id,
      });
    },
    [isMyTurn, turn, card, sendEvent],
  );

  const pass = useCallback(() => {
    void sendEvent({ type: "truthOrDare", phase: "pass", turn });
  }, [sendEvent, turn]);

  const reset = useCallback(() => {
    void sendEvent({ type: "truthOrDare", phase: "reset" });
  }, [sendEvent]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-outfit)] text-xs uppercase tracking-[1.5px] text-zinc-500">
          {card ? "Reveal" : isMyTurn ? "Your turn" : `${partnerName}'s turn`}
        </span>
        <button
          type="button"
          onClick={reset}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          New game
        </button>
      </div>

      {card ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div
            className={
              "flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl p-5 text-center " +
              (card.type === "truth"
                ? "bg-indigo-100 text-indigo-900"
                : "bg-rose-100 text-rose-900")
            }
          >
            <span className="text-[10px] font-semibold uppercase tracking-[2px] opacity-70">
              {card.type}
            </span>
            <p className="font-[family-name:var(--font-outfit)] text-base leading-snug">
              {card.text}
            </p>
          </div>
          <button
            type="button"
            onClick={pass}
            className="w-full rounded-lg border border-amber-300 bg-amber-100 px-3 py-2.5 font-[family-name:var(--font-outfit)] text-sm font-medium text-amber-900 transition hover:bg-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            Done — pass to {partnerName}
          </button>
        </div>
      ) : isMyTurn ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
          <p className="font-[family-name:var(--font-outfit)] text-sm text-zinc-700">
            Pick your poison
          </p>
          <div className="flex w-full gap-2">
            <button
              type="button"
              onClick={() => pick("truth")}
              className="flex-1 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-6 font-[family-name:var(--font-outfit)] text-base font-semibold text-indigo-900 transition hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Truth
            </button>
            <button
              type="button"
              onClick={() => pick("dare")}
              className="flex-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-6 font-[family-name:var(--font-outfit)] text-base font-semibold text-rose-900 transition hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            >
              Dare
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white/60 px-4 text-center">
          <p className="font-[family-name:var(--font-outfit)] text-sm text-zinc-600">
            Waiting for {partnerName} to pick…
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Convenience wrapper that reads the room and hands identity+name down.
 * Parent uses this rather than the raw component so the identity plumbing
 * stays in one place.
 */
export function TruthOrDarePanel({ room }: { room: Room }) {
  const me = room.localParticipant;
  // Solo state: no partner yet — game requires two. Show a friendly
  // placeholder so a soloist opening it doesn't get a broken UI.
  const partner = [...room.remoteParticipants.values()][0];
  if (!partner) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white/60 p-4 text-center">
        <p className="font-[family-name:var(--font-outfit)] text-sm text-zinc-600">
          Truth or Dare needs two players. Waiting for someone to join…
        </p>
      </div>
    );
  }
  return (
    <TruthOrDare
      meIdentity={me.identity}
      partnerIdentity={partner.identity}
      partnerName={partner.name ?? "your partner"}
    />
  );
}
