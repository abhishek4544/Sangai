"use client";

/**
 * Draw Together — shared real-time canvas game.
 *
 * Wire model: per-segment events. When a user drags, we broadcast a stream
 * of {from, to, color, size, strokeId} segments in normalized 0-1 coords so
 * peers render at their own canvas size without agreeing on pixel dims. LOSSY
 * per-segment (`use-room-channel.reliabilityFor`) — a dropped one is a tiny
 * gap in the line; the drawer's hand keeps moving.
 *
 * Local state: none. We draw both my own strokes and incoming remote strokes
 * directly onto the canvas 2D context. There's no strokes list, so a resize
 * loses the picture — acceptable for MVP; guarded against by keeping the
 * canvas at a fixed CSS size and re-sizing only on remount.
 *
 * Prompt bar: `draw.prompt` broadcasts a new random prompt id from the deck
 * in `draw-prompts.ts`. RELIABLE — both peers see the same prompt or the
 * game feels broken.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import type { RoomEvent as ChannelEvent } from "@/lib/room/envelope";
import {
  DRAW_PROMPTS,
  getDrawPrompt,
  pickRandomDrawPromptId,
} from "@/lib/games/draw-prompts";

/** Palette — 7 colors + white (eraser). Small enough to fit horizontally in
 *  the 416px games column without wrapping. */
const COLORS = [
  "#18181b", // ink
  "#ef4444", // red
  "#f59e0b", // amber
  "#22c55e", // green
  "#3b82f6", // blue
  "#a855f7", // purple
  "#ec4899", // pink
  "#ffffff", // eraser (white)
] as const;

const SIZES = [3, 6, 12] as const;

/** Base for random stroke ids. `crypto.randomUUID` is fine but overkill —
 *  we just need collision-free within a session. */
function makeStrokeId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function DrawTogetherPanel() {
  const { sendEvent, subscribe } = useRoomChannel();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [color, setColor] = useState<string>(COLORS[0]);
  const [size, setSize] = useState<number>(SIZES[1]);
  const [promptId, setPromptId] = useState<string>(DRAW_PROMPTS[0]!.id);

  // Draw a single segment onto the canvas. Coordinates are normalized 0-1.
  const drawSegment = useCallback(
    (
      from: { x: number; y: number },
      to: { x: number; y: number },
      lineColor: string,
      lineSize: number,
    ) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = lineSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(from.x * canvas.width, from.y * canvas.height);
      ctx.lineTo(to.x * canvas.width, to.y * canvas.height);
      ctx.stroke();
    },
    [],
  );

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  // Wire canvas to its actual pixel size (retina-friendly).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    // scale so lineWidth is expressed in CSS px, not device px
    ctx?.scale(dpr, dpr);
  }, []);

  // Subscribe to inbound draw events.
  useEffect(() => {
    const handler = (event: ChannelEvent) => {
      if (event.type !== "draw") return;
      if (event.phase === "segment") {
        drawSegment(event.from, event.to, event.color, event.size);
      } else if (event.phase === "clear") {
        clearCanvas();
      } else if (event.phase === "prompt") {
        setPromptId(event.id);
        clearCanvas();
      }
    };
    return subscribe(handler);
  }, [subscribe, drawSegment, clearCanvas]);

  // Local drawing state — active stroke id + last point.
  const strokeRef = useRef<{ id: string; last: { x: number; y: number } } | null>(null);

  const localPoint = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const p = localPoint(e);
    strokeRef.current = { id: makeStrokeId(), last: p };
    // Draw a single dot for a tap (from=to renders a filled cap).
    drawSegment(p, p, color, size);
    void sendEvent({
      type: "draw",
      phase: "segment",
      strokeId: strokeRef.current.id,
      from: p,
      to: p,
      color,
      size,
    });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!strokeRef.current) return;
    const p = localPoint(e);
    const from = strokeRef.current.last;
    drawSegment(from, p, color, size);
    void sendEvent({
      type: "draw",
      phase: "segment",
      strokeId: strokeRef.current.id,
      from,
      to: p,
      color,
      size,
    });
    strokeRef.current.last = p;
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    strokeRef.current = null;
  };

  const newPrompt = () => {
    const next = pickRandomDrawPromptId(promptId);
    setPromptId(next);
    clearCanvas();
    void sendEvent({ type: "draw", phase: "prompt", id: next });
  };

  const clearAll = () => {
    clearCanvas();
    void sendEvent({ type: "draw", phase: "clear" });
  };

  const prompt = getDrawPrompt(promptId);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Prompt bar */}
      <div className="flex items-center gap-2 rounded-md bg-amber-50 px-2.5 py-1.5">
        <span className="flex-1 font-[family-name:var(--font-outfit)] text-xs leading-snug text-amber-900">
          <span className="mr-1 font-semibold">Draw:</span>
          {prompt?.text ?? "…"}
        </span>
        <button
          type="button"
          onClick={newPrompt}
          className="rounded-md border border-amber-300 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[1px] text-amber-800 transition hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          New
        </button>
      </div>

      {/* Canvas */}
      <div className="relative flex-1 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="h-full w-full touch-none"
          aria-label="Shared drawing canvas"
        />
      </div>

      {/* Color palette */}
      <div className="flex flex-wrap items-center gap-1.5">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c === "#ffffff" ? "Eraser" : `Color ${c}`}
            aria-pressed={color === c}
            onClick={() => setColor(c)}
            style={{ backgroundColor: c }}
            className={
              "size-6 rounded-full border-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 " +
              (color === c
                ? "border-zinc-900 shadow-sm"
                : "border-white shadow-sm hover:scale-110")
            }
          >
            {c === "#ffffff" && (
              <span aria-hidden className="block text-[10px] text-zinc-400">
                ⌫
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Brush sizes + clear */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              aria-label={`Brush size ${s}`}
              aria-pressed={size === s}
              onClick={() => setSize(s)}
              className={
                "flex size-6 items-center justify-center rounded-full border-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 " +
                (size === s
                  ? "border-zinc-900 bg-zinc-100"
                  : "border-white bg-zinc-50 hover:border-zinc-300")
              }
            >
              <span
                aria-hidden
                className="block rounded-full bg-zinc-900"
                style={{ width: `${s}px`, height: `${s}px` }}
              />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={clearAll}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 font-[family-name:var(--font-outfit)] text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          Clear all
        </button>
      </div>
    </div>
  );
}
