# W-MVP — Watch-together room

**Status:** In progress
**Milestone:** W-MVP (post-pivot; supersedes M2–M5 on the active path)
**Owner:** Product

## Problem statement

Long-distance friends and partners already do "watch this with me" — they open
YouTube / Twitch / a sports stream / a video on X and try to share it over
Discord, iMessage, or a phone call. The improvised paths leak: Discord screen-
share drops or mangles audio, one person narrates what's happening on the other
side, or someone pays for Rabbit / Kast — apps that still force accounts and
browser extensions. Nothing in the free tier lets two or three people jump into
a shared room in under 30 seconds, hear each other, and watch the same clip
together with its audio intact.

W-MVP is that room. Host clicks a button, gets a short code, DMs it to whoever
they want to watch with, and the room hands everyone voice + video plus a
shared browser tab the host is watching. No accounts, no extensions, no
per-hour cost.

## User personas

**Long-distance partner (host).** Wants to watch something with their partner
tonight. Has the tab already open (YouTube, Twitch, a sports feed, a clip on
X). Wants their partner in the room in one message: "join room ABCD, nickname
whatever." Cares that the audio actually works and they can hear each other
while it plays.

**Long-distance partner (joiner).** Got a code in a DM. Wants to be watching
in seconds, not signing up. Won't install anything, won't pick a username
they'll use again, doesn't want a friends list.

**Casual friend group (secondary).** Three or four friends reacting together
to a match, a keynote, or a viral clip. Same shape as the couple case with
3–4 tiles instead of 2 — called out so layout survives it, not because they
need different features.

## Scope (what W-MVP must do)

- Landing page at `/` offers two paths: **Create room** and **Join room**
  (code + nickname field).
- Creating a room generates a short, shareable **room code** server-side, mints
  the host's join token, and drops the host into `/room/[code]` as the host.
- Joining with a valid code + nickname drops the joiner into `/room/[code]`
  as a guest.
- Inside the room, every participant has **voice + video** with every other
  participant, laid out as tiles.
- The host — and only the host — has a **Share a tab** control that shares a
  single browser tab **including its audio**. All guests see the shared tab
  and hear its audio in near real-time, alongside voice chat.
- Room code is visible inside the room with a **Copy code** affordance for
  re-sharing mid-session.
- Every participant has a **Leave** control that ends their session cleanly
  (camera + mic released, they land back on `/`).
- The landing page and the room UI carry an upfront **DRM warning**: Netflix,
  Prime, Disney+, HBO Max, and similar will show a black frame on the guest
  side. This is a browser DRM restriction, not a bug.

## Acceptance criteria

### AC1 — Create room + get shareable code
**Given** a user is on `/`
**When** they click **Create room**
**Then** a room code is generated server-side (not `Math.random`), the user is
navigated into `/room/[code]` as the host with camera + mic already negotiated
for join, and the room code is visible in the room UI within 3 seconds on a
warm connection. The same code, entered on another device, joins the same
room.

### AC2 — Join room by code with a nickname (no account)
**Given** a user is on `/` and has been sent a valid room code out-of-band
**When** they enter the code, enter a nickname, and click **Join**
**Then** they are navigated into `/room/[code]` as a guest, their nickname is
the label under their tile for other participants, and at no point in the flow
were they asked to sign up, log in, verify an email, or install anything. An
invalid or expired code shows a plain "That code isn't active — double-check
it with whoever sent it" message and stays on `/`.

### AC3 — See other participants (video tiles) and hear them (voice)
**Given** two or more participants are in the same `/room/[code]`
**When** the second (and each subsequent) participant finishes joining
**Then** every participant sees a video tile per other participant labeled
with that participant's nickname, hears every other participant's microphone
audio, and the tile layout adapts sensibly for 2, 3, and 4 participants
without overlapping controls. A participant with camera or mic denied at the
browser prompt still joins, still hears others, and appears as a tile with a
clear "camera off" / "mic off" indicator instead of a broken tile.

### AC4 — Host screen-shares a browser tab, guests see the video AND hear its audio
**Given** the host is in a room with at least one guest and has a browser tab
open playing a non-DRM video (YouTube, Twitch, live sports, an X video)
**When** the host clicks **Share a tab**, selects that tab in the browser's
native share picker, and confirms **Share tab audio**
**Then** every guest sees the shared tab rendered in the room within 3 seconds
of the picker confirming, hears the tab's audio mixed with voice chat, the
host's own video tile does not disappear (voice + camera keep working
alongside the share), and stopping the share (host clicks **Stop sharing** or
uses the browser's native "Stop sharing" bar) removes the shared surface for
every guest within 2 seconds and returns the room to voice + video only.

### AC5 — Copy code to clipboard
**Given** a participant is inside `/room/[code]`
**When** they click the **Copy code** affordance next to the visible room code
**Then** the current room code is written to the OS clipboard, a short visual
confirmation ("Copied") is shown for ~2 seconds, and pasting into any text
field yields exactly the code as displayed — no leading/trailing whitespace,
no URL, no extra characters.

### AC6 — Leave the room cleanly
**Given** a participant is inside `/room/[code]`
**When** they click **Leave**
**Then** their microphone and camera hardware indicators (browser mic/camera
lights) turn off within 2 seconds, they are navigated to `/`, and every
remaining participant sees their tile disappear from the layout within 2
seconds. If the host leaves and any guests remain, the room continues for the
remaining guests (voice + video keeps working) and the shared tab, if any,
ends for everyone. Closing the browser tab or navigating away must have the
same effect on the remaining participants as clicking **Leave** — no ghost
tiles left behind.

### AC7 — DRM warning is unmissable
**Given** a user is on `/` or has just entered a room
**When** the page or room UI first renders
**Then** a short DRM-limitation notice is shown at least once per session in
plain language ("Netflix, Prime, Disney+ and HBO won't show up for other
people — that's a browser restriction, not a bug"), visible without scrolling
on desktop, and dismissible. The notice must render **before** the host is
handed the **Share a tab** control on their first session.

### AC8 — Keyboard + a11y
**Given** the user is on `/` or inside `/room/[code]`
**When** they Tab through the page
**Then** every interactive control (**Create room**, code input, nickname
input, **Join**, **Copy code**, **Share a tab**, **Leave**, mic-toggle,
camera-toggle) is a focusable native control or has an equivalent ARIA role,
Enter/Space activates buttons, toggle-style controls (mic, camera, share)
expose their pressed state to assistive tech, and tile labels are readable by
a screen reader so a nickname change is announced.

## Out of scope (explicit — do not sneak these into W-MVP)

- **Netflix / Prime / Disney+ / HBO Max playback.** DRM sites render as a
  black frame on the remote side; browsers block the tab-capture pipeline
  for protected content. The UI warns upfront (AC7); we do not try to
  defeat DRM, proxy the video, or ship a "protected content mode."
- **Persistent accounts, sign-in, friends list, room history.** Anonymous
  join; the room code is the only capability token.
- **Text chat inside the room.** Voice is the chat surface in W-MVP.
- **Mobile-optimized layouts.** Desktop-first (Chrome/Edge on macOS/Windows).
  Mobile may partially work; not a supported target, not on the QA matrix.
- **Screen-share layout controls** (fullscreen toggle for the shared tile,
  pin/unpin, PiP, side-by-side vs. stage). Default layout only.
- **Playback state sync.** Host controls their own tab; guests just watch.
  No shared pause/play/seek, no timestamp sync, no host handoff.
- **Kick, mute-other, ban, room moderation.** Anyone with the code is a
  peer; if that breaks, the host leaves and creates a new room.
- **Recording** — client-side or server-side, voice, video, or shared tab.
- **Multi-tab / multi-source share.** One shared tab at a time, hosted by
  the host. No "guest takes over the share."
- **Movie recommender surfaces** (`/api/movies`, hidden-gem toggle, chip
  picker). Parked per CLAUDE.md; the code stays, the milestones don't.

## Success metric

**Primary — real usage, not a demo.** Within the first week after ship,
**≥ 3 distinct sessions of ≥ 15 minutes with 2–4 real participants each**
(the user + 1–3 friends/partner), where at least one session includes a
successful **Share a tab** for ≥ 5 minutes and no participant reports that
audio was missing or one-way. Measured by session logs plus a one-message
post-session ask ("did it actually work?").

**Coverage gate — the room doesn't fall apart at 3.** At least one of those
sessions must be **3 participants or more** and complete without a
participant having to rejoin due to the client freezing, dropping, or losing
audio. If every successful session is 2-person only, the room UI has not been
validated for the small-group case and W-MVP is not considered done.

**Secondary (watch, don't gate on):** median time from a joiner submitting
**Join** → their tile appearing to the host under 4 seconds on a warm
connection.

## Open questions

1. **Room code length and character set.** Short enough to type from a DM,
   long enough that guessing is impractical inside the room's lifetime.
   Suggest **6 chars, uppercase alphanumeric excluding look-alikes (0/O,
   1/I/L)**. Confirm before build.
2. **Room TTL — when does a code stop working.** LiveKit rooms have a
   configurable empty-timeout; we need a number. Suggest: valid while at
   least one participant is in the room, plus a **10-minute idle grace**
   after the last leaves, then the code is dead and reusing it 404s.
3. **Max participants per room.** Bounded by the LiveKit free/dev tier and
   by the desktop layout. Suggest **hard cap at 4**; joins beyond that get
   a plain "This room is full" message. Confirm the LiveKit ceiling.
4. **Nickname collisions and sanitization.** Two guests both pick "sam."
   Suggest: allow it, disambiguate per-tile if needed; server-side strip
   control chars and cap at 20 chars. Nickname is display-only per
   CLAUDE.md — confirm we're not persisting or trusting it anywhere.
5. **"Warn on tab close" prompt for the host.** Host closing their tab
   ends the shared surface for everyone. Install a `beforeunload`
   confirmation, or rely on AC6's clean-exit behavior? Recommend **no
   prompt** — fewer surprises, matches the disposable posture.
6. **Where does the DRM warning live long-term?** AC7 puts it on `/` and
   in the room on first load. Worth a persistent "i" affordance next to
   **Share a tab**, or does the initial notice carry it?
