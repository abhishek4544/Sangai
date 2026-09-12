"use client";

/**
 * Real-time chat panel (product ask 2026-09-05).
 *
 * Message history is per-tab, no persistence — messages are broadcast on
 * the LiveKit data channel and appended to a local list on receipt. A
 * late joiner sees only messages sent from that point on (the ADR §2
 * snapshot handshake doesn't carry history; adding it would add a lot of
 * plumbing for marginal MVP value).
 *
 * Text safety:
 *  - Rendered as text (React escapes), never as HTML — no XSS surface.
 *  - Envelope schema caps at 500 chars, so an oversized inbound is dropped
 *    at decode time.
 *  - Client-side send rate limit (10 msgs / 10 s) so a stuck-key user
 *    can't spam the room.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import { ReactionLimiter } from "@/lib/room/rate-limit";
import type { RoomEvent as ChannelEvent } from "@/lib/room/envelope";

const MAX_CHARS = 500;

interface ChatMessage {
  key: string;
  text: string;
  name: string;
  fromLocal: boolean;
}

/** Stable, non-cryptographic key for a chat bubble. */
function makeMessageKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 12);
  }
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface ChatPanelProps {
  nickname: string;
  localIdentity: string;
}

export function ChatPanel({ nickname, localIdentity }: ChatPanelProps) {
  const { sendEvent, subscribe } = useRoomChannel();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Reuse ReactionLimiter — same ring-buffer semantics fit chat.
  const limiterRef = useRef<ReactionLimiter | null>(null);
  if (limiterRef.current === null) {
    limiterRef.current = new ReactionLimiter(10, 10_000);
  }

  // Subscribe to inbound chat events. Messages we send ourselves come
  // through the same path (sendEvent applies locally), so we don't need
  // to double-append on submit.
  useEffect(() => {
    const handler = (event: ChannelEvent, from: string) => {
      if (event.type !== "chat") return;
      setMessages((prev) => [
        ...prev,
        {
          key: makeMessageKey(),
          text: event.text,
          name: event.name,
          fromLocal: from === localIdentity,
        },
      ]);
    };
    return subscribe(handler);
  }, [subscribe, localIdentity]);

  // Auto-scroll to the newest bubble on every append.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const remaining = MAX_CHARS - draft.length;
  const canSend = draft.trim().length > 0 && draft.length <= MAX_CHARS;

  const submit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const text = draft.trim();
      if (text.length === 0) return;
      if (text.length > MAX_CHARS) return;
      if (!limiterRef.current!.tryAcquire()) return;
      void sendEvent({ type: "chat", text, name: nickname });
      setDraft("");
    },
    [draft, sendEvent, nickname],
  );

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden rounded-lg bg-white">
      <div className="shrink-0 px-3 pt-2 pb-1 text-center font-[family-name:var(--font-outfit)] text-sm text-[#554100]">
        Chat with room
      </div>
      <div
        ref={scrollerRef}
        className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2"
      >
        {messages.length === 0 ? (
          <div className="my-auto text-center text-[11px] text-zinc-400">
            No messages yet. Say hi.
          </div>
        ) : (
          messages.map((m) => (
            <ChatBubble key={m.key} message={m} />
          ))
        )}
      </div>
      <form onSubmit={submit} className="shrink-0 border-t border-zinc-200 p-2">
        <div className="flex items-end gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHARS))}
            placeholder={`Say hi, ${nickname}…`}
            aria-label="Chat message"
            maxLength={MAX_CHARS}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-disabled={!canSend}
            className="rounded-lg border border-sky-700 bg-sky-700 px-3 py-2 text-xs font-medium text-white transition hover:bg-sky-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-200 disabled:text-zinc-500"
          >
            Send
          </button>
        </div>
        {remaining <= 40 && (
          <div className="mt-1 text-right text-[10px] text-zinc-500">
            {remaining} left
          </div>
        )}
      </form>
    </div>
  );
}

// ---- Floating notifications ---------------------------------------------

/**
 * Ephemeral chat message toasts that float over the stage. Matches the
 * Figma "no-share" layout where recent chat bubbles appear stacked on
 * top of the video wall so a live conversation is visible even when the
 * chat panel isn't in focus.
 *
 * Each toast auto-dismisses after ~6 s. Newest at the bottom of the
 * stack; up to 3 visible at once (older ones drop off the top).
 */
const NOTIFICATION_MS = 6000;
const MAX_VISIBLE = 3;

interface FloatingMessage {
  key: string;
  text: string;
  name: string;
  fromLocal: boolean;
}

export function ChatNotifications({ localIdentity }: { localIdentity: string }) {
  const { subscribe } = useRoomChannel();
  const [visible, setVisible] = useState<FloatingMessage[]>([]);

  useEffect(() => {
    const handler = (event: ChannelEvent, from: string) => {
      if (event.type !== "chat") return;
      const key = makeMessageKey();
      const entry: FloatingMessage = {
        key,
        text: event.text,
        name: event.name,
        fromLocal: from === localIdentity,
      };
      setVisible((prev) => {
        const next = [...prev, entry];
        // Trim from the top when we exceed MAX_VISIBLE — the oldest fades
        // early rather than piling on visually.
        return next.slice(-MAX_VISIBLE);
      });
      window.setTimeout(() => {
        setVisible((prev) => prev.filter((m) => m.key !== key));
      }, NOTIFICATION_MS);
    };
    return subscribe(handler);
  }, [subscribe, localIdentity]);

  if (visible.length === 0) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute bottom-4 right-4 z-20 flex w-[240px] flex-col items-end gap-1.5"
    >
      {visible.map((m) => (
        <div
          key={m.key}
          className={
            "max-w-full rounded-lg px-3 py-2 shadow-md backdrop-blur transition-opacity duration-300 " +
            (m.fromLocal
              ? "bg-[#ffec9f]/90 text-zinc-900"
              : "bg-white/85 text-zinc-900")
          }
        >
          {!m.fromLocal && (
            <p className="mb-0.5 font-[family-name:var(--font-outfit)] text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              {m.name}
            </p>
          )}
          <p className="whitespace-pre-wrap break-words font-[family-name:var(--font-outfit)] text-[12px] leading-[1.3]">
            {m.text}
          </p>
        </div>
      ))}
    </div>
  );
}

// ---- Bubble --------------------------------------------------------------

function ChatBubble({ message }: { message: ChatMessage }) {
  const authorLabel = useMemo(
    () => (message.fromLocal ? "You" : message.name),
    [message.fromLocal, message.name],
  );
  return (
    <div
      className={
        "max-w-[85%] rounded-md px-3 py-1.5 " +
        (message.fromLocal
          ? "self-end bg-[#ffec9f]"
          : "self-start bg-[#f3f3f3]")
      }
    >
      {!message.fromLocal && (
        <p className="mb-0.5 font-[family-name:var(--font-outfit)] text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          {authorLabel}
        </p>
      )}
      {/* Rendered as text — React escapes, no XSS surface. */}
      <p className="whitespace-pre-wrap break-words font-[family-name:var(--font-outfit)] text-[12px] leading-[1.3] text-zinc-900">
        {message.text}
      </p>
    </div>
  );
}
