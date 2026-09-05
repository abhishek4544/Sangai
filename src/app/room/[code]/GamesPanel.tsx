"use client";

/**
 * GamesPanel — right-column "Couple Games" surface shown when both people
 * are in the room and no one is screen-sharing. Two views:
 *
 *   - LIST: header + 3×2 grid of game tiles. Clicking a tile that's marked
 *     `available` broadcasts `game.open`; both peers navigate together via
 *     the room-wide LWW `activeGameId` field (see `state.ts`).
 *   - GAME: back button + the game's own component. `activeGameId` is null
 *     when no game is open (default state).
 *
 * Coming-soon tiles are visible but disabled — the empty slots in the Figma
 * mock become real cards with a "Coming soon" chip, so the roadmap is
 * discoverable without shipping placeholder buttons.
 */

import { useCallback } from "react";
import type { Room } from "livekit-client";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import { GAMES, getGameById } from "@/lib/games";
import { TruthOrDarePanel } from "./games/TruthOrDare";
import { DrawTogetherPanel } from "./games/DrawTogether";

export function GamesPanel({ room }: { room: Room | null }) {
  const { roomState, sendEvent } = useRoomChannel();
  const activeGameId = roomState.activeGameId;
  const activeGame = activeGameId ? getGameById(activeGameId) : null;

  const openGame = useCallback(
    (id: string) => {
      void sendEvent({ type: "game", phase: "open", id });
    },
    [sendEvent],
  );

  const closeGame = useCallback(() => {
    void sendEvent({ type: "game", phase: "close" });
  }, [sendEvent]);

  if (activeGame) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-lg border border-white bg-white/70 p-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={closeGame}
            aria-label="Back to games"
            className="flex size-8 items-center justify-center rounded-md border border-black/10 bg-white text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            <span aria-hidden className="text-base leading-none">
              ‹
            </span>
          </button>
          <span className="flex items-center gap-1.5 font-[family-name:var(--font-outfit)] text-sm font-medium text-zinc-900">
            <span aria-hidden>{activeGame.glyph}</span>
            {activeGame.title}
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {activeGame.id === "truth-or-dare" && room ? (
            <TruthOrDarePanel room={room} />
          ) : activeGame.id === "draw-together" ? (
            <DrawTogetherPanel />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-dashed border-zinc-300 bg-white/60 p-4 text-center">
              <p className="font-[family-name:var(--font-outfit)] text-sm text-zinc-600">
                {activeGame.title} is coming soon. Say <em>next</em> and I&apos;ll
                build it.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-lg border border-white bg-white/60 p-3 backdrop-blur">
      <h2 className="font-[family-name:var(--font-outfit)] text-lg font-medium text-zinc-900">
        Couple Games
      </h2>
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-2">
        {GAMES.map((g) => {
          const disabled = g.status !== "available";
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => openGame(g.id)}
              disabled={disabled}
              aria-disabled={disabled}
              title={disabled ? "Coming soon" : g.tagline}
              className={
                "group relative flex flex-col items-center justify-center gap-1 rounded-lg border border-black/5 bg-white p-2 text-center shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 " +
                (disabled
                  ? "cursor-not-allowed opacity-60"
                  : "hover:-translate-y-0.5 hover:shadow-md")
              }
            >
              <span aria-hidden className="text-2xl leading-none">
                {g.glyph}
              </span>
              <span className="font-[family-name:var(--font-outfit)] text-[11px] font-medium leading-tight text-zinc-900">
                {g.title}
              </span>
              {disabled && (
                <span className="absolute right-1 top-1 rounded-full bg-zinc-100 px-1.5 py-[1px] text-[8px] font-semibold uppercase tracking-[1px] text-zinc-500">
                  Soon
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
