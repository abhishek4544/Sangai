"use client";

import { Suspense, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ROOM_CODE_LENGTH, ROOM_CODE_REGEX } from "@/lib/livekit/code-shared";
import { saveRoomSession } from "@/lib/room-session";
import { LandingHeader } from "./LandingHeader";

/**
 * Landing page — two affordances (create / join) side-by-side. No LiveKit SDK
 * on this route; it lives on `/room/[code]` and is lazy-loaded there.
 *
 * The DRM notice at the top satisfies PM AC7: "unmissable, above the fold,
 * dismissible, persisted per session". We use localStorage (not sessionStorage)
 * so the same person coming back tomorrow isn't re-warned, matching the
 * "shown at least once per session" AC copy taken loosely — a stricter reading
 * (per browser session) would suggest sessionStorage; we picked localStorage
 * because the same warning three times a night is worse than showing it once
 * a week. If product wants per-session, flip the storage backing.
 */

const DRM_DISMISS_KEY = "movie-night:drm-notice-dismissed";
const NICKNAME_MAX = 20;

/** `useSyncExternalStore` subscribe fn — re-check on cross-tab storage events.
 *  Same-tab writes don't fire `storage`, so we still need the in-component
 *  override state for immediate feedback on click. */
function subscribeToStorageEvents(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

interface CreateResponse {
  code: string;
  token: string;
  url: string;
}

interface JoinResponse {
  token: string;
  url: string;
}

interface ApiError {
  error: string;
  message?: string;
}

async function readError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as ApiError;
    if (body && typeof body === "object" && typeof body.error === "string") {
      return body;
    }
    return { error: "unknown" };
  } catch {
    return { error: "unknown" };
  }
}

function retryAfterMessage(res: Response, fallback: string): string {
  const retryAfter = res.headers.get("Retry-After");
  const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    return `Too many attempts — try again in ${seconds}s.`;
  }
  return fallback;
}

export default function LandingPage() {
  return (
    <main
      className="relative flex-1 overflow-hidden [color-scheme:light]"
      style={{
        background:
          "linear-gradient(to bottom, #bce8ff 0%, #9adaff 55%, #7dccff 100%)",
      }}
    >
      {/* Soft cloud puffs — layered radial gradients approximate the Figma shader */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: [
            "radial-gradient(ellipse 55% 32% at 18% 22%, rgba(255,255,255,0.55), transparent 70%)",
            "radial-gradient(ellipse 45% 26% at 68% 14%, rgba(255,255,255,0.5), transparent 70%)",
            "radial-gradient(ellipse 38% 30% at 42% 45%, rgba(255,255,255,0.32), transparent 70%)",
            "radial-gradient(ellipse 50% 28% at 88% 40%, rgba(255,255,255,0.42), transparent 70%)",
            "radial-gradient(ellipse 42% 24% at 10% 55%, rgba(255,255,255,0.3), transparent 70%)",
          ].join(","),
        }}
      />

      {/* Grass strip along the bottom */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-56 sm:h-72 lg:h-80"
        style={{
          backgroundImage: "url(/grass.png)",
          backgroundRepeat: "repeat-x",
          backgroundSize: "auto 100%",
          backgroundPosition: "bottom center",
        }}
      />

      <LandingHeader />

      <div className="relative mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="mb-6">
          <p className="text-sm text-slate-700">
            Watch something together. Voice + video call, and the host can
            share a browser tab.
          </p>
        </header>

        <DrmNotice />

        {/* Suspense wraps useSearchParams — Next 15+ requires a boundary so a
            static shell can render before client-side query params resolve. */}
        <Suspense fallback={<LandingCardsFallback />}>
          <LandingCards />
        </Suspense>
      </div>
    </main>
  );
}

function LandingCardsFallback() {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div
        aria-hidden
        className="h-64 rounded-xl border border-white/70 bg-white/70 shadow-lg backdrop-blur"
      />
      <div
        aria-hidden
        className="h-64 rounded-xl border border-white/70 bg-white/70 shadow-lg backdrop-blur"
      />
    </div>
  );
}

function LandingCards() {
  const searchParams = useSearchParams();

  // If the room page bounced us back with ?join=<code>, prefill the join form.
  const prefillCode = useMemo(() => {
    const raw = searchParams.get("join");
    if (!raw) return "";
    const up = raw.toUpperCase();
    // Only accept if it's plausibly a code — otherwise ignore silently.
    return ROOM_CODE_REGEX.test(up) ? up : "";
  }, [searchParams]);

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <CreateCard />
      <JoinCard prefillCode={prefillCode} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// DRM notice — dismissible, persists dismissal in localStorage
// ---------------------------------------------------------------------------

function DrmNotice() {
  // `useSyncExternalStore` is React 19's blessed way to consume browser stores
  // like localStorage: no useState-in-effect, and it returns a safe SSR value
  // via the getServerSnapshot arg. On the server we render `null` (hidden);
  // on the first client render we read localStorage synchronously.
  const dismissed = useSyncExternalStore(
    subscribeToStorageEvents,
    () => window.localStorage.getItem(DRM_DISMISS_KEY) === "1",
    () => true, // SSR: pretend dismissed so the notice doesn't flash server-side
  );
  // Track an in-memory override so clicking "Got it" hides immediately, before
  // the storage-event round-trip.
  const [dismissedOverride, setDismissedOverride] = useState(false);

  function dismiss() {
    setDismissedOverride(true);
    try {
      window.localStorage.setItem(DRM_DISMISS_KEY, "1");
    } catch {
      // Storage inaccessible — the in-memory override still hides it.
    }
  }

  if (dismissed || dismissedOverride) return null;

  return (
    <aside
      role="note"
      aria-label="DRM streaming limitation"
      className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <div className="flex-1">
        <p className="font-medium">Heads up about DRM.</p>
        <p className="mt-1">
          Streaming Netflix / Prime / Disney+? Their DRM blocks screen-share —
          those will show as a black frame. YouTube, Twitch, sports streams,
          and most other sites work.
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss DRM notice"
        className="rounded-md border border-transparent px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 focus-visible:ring-offset-amber-50 dark:text-amber-100 dark:hover:bg-amber-900/40 dark:focus-visible:ring-offset-amber-950"
      >
        Got it
      </button>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Create-room card
// ---------------------------------------------------------------------------

function CreateCard() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const trimmedNickname = nickname.trim().slice(0, NICKNAME_MAX);
  const canSubmit = status !== "loading" && trimmedNickname.length > 0;

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;

    setStatus("loading");
    setError(null);

    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Backend doesn't currently accept a nickname on /api/rooms, but sending
        // one is forward-compatible and keeps the two calls symmetric. We also
        // stash the nickname locally so the host tile can label itself.
        body: JSON.stringify({ nickname: trimmedNickname }),
      });

      if (!res.ok) {
        const body = await readError(res);
        if (res.status === 429) {
          setError(
            retryAfterMessage(
              res,
              body.message ?? "Too many attempts — try again in a moment.",
            ),
          );
        } else if (res.status === 503) {
          setError(
            body.message ?? "Couldn't create a room right now. Try again in a moment.",
          );
        } else {
          setError(body.message ?? "Something went wrong. Try again.");
        }
        setStatus("error");
        return;
      }

      const data = (await res.json()) as CreateResponse;
      if (!data.code || !data.token || !data.url) {
        setError("Server sent an incomplete response. Try again.");
        setStatus("error");
        return;
      }

      saveRoomSession(data.code, {
        token: data.token,
        url: data.url,
        nickname: trimmedNickname,
        isHost: true,
      });

      router.push(`/room/${data.code}`);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setStatus("error");
    }
  }

  return (
    <form
      onSubmit={handleCreate}
      className="flex flex-col gap-4 rounded-xl border border-white/70 bg-white/80 p-5 shadow-lg backdrop-blur"
      noValidate
    >
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Create a room
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          You get a code to share. Anyone with the code can join.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="create-nickname"
          className="text-sm font-medium text-slate-800"
        >
          Your nickname
        </label>
        <input
          id="create-nickname"
          name="nickname"
          type="text"
          autoComplete="off"
          maxLength={NICKNAME_MAX}
          required
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          disabled={status === "loading"}
          placeholder="e.g. sam"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex items-center justify-center rounded-md border border-transparent bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "loading" ? (
          <>
            <Spinner />
            <span className="ml-2">Creating…</span>
          </>
        ) : (
          "Create room"
        )}
      </button>

      <p
        role="status"
        aria-live="polite"
        className={
          "min-h-[1.25rem] text-sm " +
          (error ? "text-red-700" : "text-transparent select-none")
        }
      >
        {error ?? "placeholder"}
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Join-room card
// ---------------------------------------------------------------------------

function JoinCard({ prefillCode }: { prefillCode: string }) {
  const router = useRouter();
  const [code, setCode] = useState(prefillCode);
  const [nickname, setNickname] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const trimmedNickname = nickname.trim().slice(0, NICKNAME_MAX);
  const normalizedCode = code.toUpperCase();
  const codeIsValidShape = ROOM_CODE_REGEX.test(normalizedCode);
  const canSubmit =
    status !== "loading" &&
    codeIsValidShape &&
    trimmedNickname.length > 0;

  async function handleJoin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;

    setStatus("loading");
    setError(null);

    try {
      const res = await fetch(`/api/rooms/${normalizedCode}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nickname: trimmedNickname }),
      });

      if (!res.ok) {
        const body = await readError(res);
        if (res.status === 429) {
          setError(
            retryAfterMessage(
              res,
              body.message ?? "Too many attempts — try again in a moment.",
            ),
          );
        } else {
          // 400 / 404 / 409 / 503 / 500 all pass through with the server's
          // human-facing message (verbatim per the backend contract).
          setError(body.message ?? "That didn't work. Double-check the code.");
        }
        setStatus("error");
        return;
      }

      const data = (await res.json()) as JoinResponse;
      if (!data.token || !data.url) {
        setError("Server sent an incomplete response. Try again.");
        setStatus("error");
        return;
      }

      saveRoomSession(normalizedCode, {
        token: data.token,
        url: data.url,
        nickname: trimmedNickname,
        isHost: false,
      });

      router.push(`/room/${normalizedCode}`);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setStatus("error");
    }
  }

  return (
    <form
      onSubmit={handleJoin}
      className="flex flex-col gap-4 rounded-xl border border-white/70 bg-white/80 p-5 shadow-lg backdrop-blur"
      noValidate
    >
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Join with a code
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Paste the code someone sent you.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="join-code"
          className="text-sm font-medium text-slate-800"
        >
          Room code
        </label>
        <input
          id="join-code"
          name="code"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          maxLength={ROOM_CODE_LENGTH}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          disabled={status === "loading"}
          placeholder="ABCDEF"
          aria-describedby="join-code-hint"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-lg uppercase tracking-[0.35em] text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <p id="join-code-hint" className="text-xs text-slate-500">
          6 characters. No 0/O or 1/I/L.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="join-nickname"
          className="text-sm font-medium text-slate-800"
        >
          Your nickname
        </label>
        <input
          id="join-nickname"
          name="nickname"
          type="text"
          autoComplete="off"
          maxLength={NICKNAME_MAX}
          required
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          disabled={status === "loading"}
          placeholder="e.g. sam"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex items-center justify-center rounded-md border border-transparent bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "loading" ? (
          <>
            <Spinner />
            <span className="ml-2">Joining…</span>
          </>
        ) : (
          "Join"
        )}
      </button>

      <p
        role="status"
        aria-live="polite"
        className={
          "min-h-[1.25rem] text-sm " +
          (error ? "text-red-700" : "text-transparent select-none")
        }
      >
        {error ?? "placeholder"}
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Spinner — no external icon lib; SVG is 20 lines
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4 animate-spin text-white"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        className="opacity-25"
      />
      <path
        d="M4 12a8 8 0 018-8"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        className="opacity-75"
      />
    </svg>
  );
}
