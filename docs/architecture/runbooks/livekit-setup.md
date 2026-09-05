# Runbook — LiveKit Cloud setup

Human-only steps to unblock the watch-together MVP (ADR 0004). The backend
engineer (W3) is blocked until `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and
`LIVEKIT_API_SECRET` are populated in every environment (local, Vercel
preview, Vercel production).

## Steps

1. **Sign up.** Go to https://cloud.livekit.io and create an account. The
   free tier is what the MVP is sized for; no credit card required.
2. **Create a project.** From the dashboard, click *Create Project*. Any
   name works (e.g. `movie-night-dev`); the URL you get back is what the
   client connects to.
3. **Copy credentials.** In the project's *Settings → Keys* page, copy:
   - Project URL → `LIVEKIT_URL` (looks like `wss://<slug>.livekit.cloud`)
   - API Key → `LIVEKIT_API_KEY`
   - API Secret → `LIVEKIT_API_SECRET` (long, ~40+ chars — do not truncate)
4. **Write to `.env.local`.** In the repo root, open `.env.local` (create
   it if missing — it's gitignored) and paste the three values. Do **not**
   commit this file. Do **not** put these in `.env.example`.
5. **Verify locally.** Run `npm run build` from the repo root. If the vars
   are missing or malformed, the build fails at boot with a message
   pointing at the specific var — that is the correct behavior.
6. **Confirm free-tier caps.** In the LiveKit dashboard, note the current
   free-tier ceilings for this project (participants per room, connection
   minutes / month, bandwidth). Record them below so we know when we're
   approaching the ceiling:
   - Max participants per room: **____** (product target: 4)
   - Connection minutes / month: **____**
   - Bandwidth / month: **____**
   - Date checked: **____**
   File a tech-debt entry in `docs/architecture/tech-debt.md` if any cap
   is within 2x of expected MVP load.
7. **Add to Vercel (preview + production).** From the repo root, with the
   Vercel CLI logged in and the project linked:
   ```
   vercel env add LIVEKIT_URL preview production
   vercel env add LIVEKIT_API_KEY preview production
   vercel env add LIVEKIT_API_SECRET preview production
   ```
   Each command prompts once for the value and stores it encrypted. Do
   **not** add these to the `development` scope — local dev reads from
   `.env.local`.
8. **Redeploy.** Trigger a fresh Vercel deploy (`vercel --prod` for prod,
   or push to a branch for preview) so the new env vars take effect.

## Rotation

If a secret leaks: rotate it in the LiveKit dashboard (*Settings → Keys →
Regenerate*), update `.env.local` and both Vercel scopes, and redeploy.
Old tokens minted with the previous secret stop working immediately.
