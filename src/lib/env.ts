import "server-only";
import { z } from "zod";

const EnvSchema = z.object({
  // Recommender (parked but retained — see CLAUDE.md pivot note).
  TMDB_API_KEY: z.string().min(1, "TMDB_API_KEY is required"),

  // LiveKit Cloud — required for the watch-together MVP (W-MVP / ADR 0004).
  // Server-only. NEVER expose via NEXT_PUBLIC_*. The URL is returned to the
  // browser inside the token-mint response (that is safe — it is the public
  // websocket endpoint, not a secret); the API key/secret never leave the
  // server.
  LIVEKIT_URL: z
    .string()
    .url("LIVEKIT_URL must be a valid URL (e.g. wss://your-project.livekit.cloud)")
    .refine(
      (u) => u.startsWith("wss://"),
      "LIVEKIT_URL must start with wss:// (LiveKit websocket endpoint)",
    ),
  LIVEKIT_API_KEY: z.string().min(1, "LIVEKIT_API_KEY is required"),
  LIVEKIT_API_SECRET: z
    .string()
    .min(
      32,
      "LIVEKIT_API_SECRET must be at least 32 chars (LiveKit-issued secrets are long; a shorter value is almost certainly a placeholder)",
    ),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(
    [
      "Invalid environment variables:",
      issues,
      "",
      "Set them in .env.local (see .env.example for the full list).",
      "For LiveKit setup steps, see docs/architecture/runbooks/livekit-setup.md.",
    ].join("\n"),
  );
}

export const env = parsed.data;
