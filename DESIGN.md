---
version: alpha
name: Movie Night
description: Sangai / Movie Night design system — sky-and-grass landing scene, glassy cards, sky-blue action, for a warm, low-friction co-watching product.
colors:
  primary: "#FFCC00"
  on-primary: "#443506"
  action: "#0369a1"
  action-hover: "#075985"
  on-action: "#ffffff"
  surface: "#ffffff"
  ink: "#0f172a"
  ink-body: "#334155"
  caution-bg: "#fffbeb"
  caution-text: "#78350f"
  sky-base: "#7dccff"
typography:
  heading:
    fontFamily: Geist
    fontSize: 1.125rem
    fontWeight: 600
  body:
    fontFamily: Geist
    fontSize: 0.875rem
  hint:
    fontFamily: Geist
    fontSize: 0.75rem
  code:
    fontFamily: Geist Mono
    fontSize: 1.125rem
    letterSpacing: 0.35em
  brand-pill:
    fontFamily: Outfit
    fontSize: 0.875rem
  brand-glyph:
    fontFamily: Gasoek One
    fontSize: 38px
    fontWeight: 400
rounded:
  sm: 6px
  md: 8px
  lg: 12px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 20px
  xl: 24px
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 12px
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
    textColor: "{colors.on-action}"
  input-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 10px
  input-code:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.code}"
    rounded: "{rounded.sm}"
    padding: 10px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 20px
  brand-tile:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.brand-glyph}"
    rounded: "{rounded.sm}"
    size: 40px
  brand-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.brand-pill}"
    rounded: "{rounded.md}"
    padding: 8px
  notice-caution:
    backgroundColor: "{colors.caution-bg}"
    textColor: "{colors.caution-text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 16px
  landing-hero:
    backgroundColor: "{colors.sky-base}"
    textColor: "{colors.ink-body}"
---

## Overview

**Product:** Movie Night. **Umbrella brand:** Sangai. **Feel:** a lazy afternoon — sky, clouds, grass. Warm, low-friction, low-corporate. The landing surface paints a literal sky-over-grass scene; the room UI drops the scene and leans on the same card + typography language over a neutral base.

Design tokens above are the *normative* palette and type scale — the code (`src/app/globals.css`, `src/app/page.tsx`, `src/app/LandingHeader.tsx`) is the source of truth for everything else, and this doc gets updated in the same commit as any code change that shifts a token. Non-token motifs (the five layered cloud puffs, the grass PNG strip, the glassy `backdrop-blur` treatment on cards) are described in prose below because they don't reduce to a single hex value.

## Colors

The palette has three loud roles and everything else is neutral.

- **`primary` (#FFCC00)** — Sangai brand yellow. Used on the logo tile only. Not a fill for buttons or notices.
- **`on-primary` (#443506)** — Deep ink brown paired with brand yellow (the "S" glyph).
- **`action` (#0369a1)** — Sky-700. The only primary CTA fill. Every "do the thing" button in the product. Passes WCAG AA at 5.85:1 against white text.
- **`action-hover` (#075985)** — Sky-800. Darker hover partner (unusual — most systems lighten on hover; we darken because sky-600 and lighter both fail AA against white text).
- **`on-action` (#ffffff)** — White text on `action` and `action-hover`.
- **`surface` (#ffffff)** — Card and input fill. In-code this is rendered at 80% opacity (`bg-white/80`) with `backdrop-blur` for the glassy card treatment — the token is the underlying color; the frost is an application-time choice documented under Components.
- **`ink` (#0f172a)** / **`ink-body` (#334155)** — Slate-900 and slate-700 respectively. Headings vs body copy.
- **`caution-bg` (#fffbeb)** / **`caution-text` (#78350f)** — Amber pair for the DRM-style notice and any future "heads up" surface.
- **`sky-base` (#7dccff)** — The bottom stop of the landing gradient; used as the single-color fallback if the full gradient can't render.

**Colors documented in prose but not tokenised** (used in exactly one place; codifying them adds noise without buying anything):

- Landing gradient upper stops: `#bce8ff` at 0%, `#9adaff` at 55%. Ships together with `sky-base` as one CSS `linear-gradient`.
- Cloud puffs: `rgba(255,255,255, 0.30–0.55)` across five layered radial gradients.
- Input border: `#cbd5e1` (slate-300).
- Placeholder text: `#94a3b8` (slate-400).
- Hint text: `#64748b` (slate-500).
- Secondary text: `#475569` (slate-600).
- Error text: `#b91c1c` (red-700). Inline form errors only, always in a `role="status" aria-live="polite"` region.
- Caution notice border: `#fcd34d` (amber-300).

Do NOT reuse the sky gradient off the landing surface. It is a landing-only motif that identifies the entry page.

## Typography

Four Google fonts, each with a specific role. Do not introduce a fifth without updating the tokens above.

- **Geist** (`--font-geist-sans`) — Default UI, body, form controls. `heading` (1.125rem/600) and `body` (0.875rem) tokens both use this family.
- **Geist Mono** (`--font-geist-mono`) — Room codes, code snippets. The `code` token bakes in `letterSpacing: 0.35em` and uppercase treatment (`font-mono uppercase tracking-[0.35em]` in-code); this is the signature 6-character room-code display style.
- **Outfit** (`--font-outfit`) — Brand pill wordmark ("Movie Night") and display strings. Not for body copy.
- **Gasoek One** (`--font-gasoek`, weight 400) — Logo "S" glyph only. This is a display face; do not reuse it for anything else.

Text scale in-code (references the color tokens above where applicable):

| Role | Class stack |
|---|---|
| Heading | `text-lg font-semibold text-slate-900` |
| Body | `text-sm text-slate-700` |
| Secondary | `text-sm text-slate-600` |
| Hint | `text-xs text-slate-500` |
| Placeholder | `placeholder:text-slate-400` |
| Error | `text-sm text-red-700` |

## Layout

Follow Tailwind's default scale — no custom scale here. Notable rhythm:

- Page horizontal padding: `px-4 sm:px-6 lg:px-8`
- Vertical rhythm on landing: `py-8 sm:py-12`
- Landing container max-width: `max-w-4xl`
- Gap between the two landing cards: `gap-6` (`spacing.xl` token, 24px)
- Card interior padding: `p-5` (`spacing.lg` token, 20px)
- Notice interior padding: `p-4` (`spacing.md` token, 16px)
- Form field vertical stack: `gap-4` between fields, `gap-1` label→input

The two-card landing (`Create` + `Join`) is `grid gap-6 sm:grid-cols-2`. Below the `sm` breakpoint, cards stack. This pattern is the landing's dominant composition and other surfaces should adopt it when presenting a small number of parallel affordances.

## Elevation & Depth

Two levels. Nothing between them; nothing above.

- **Subtle (`shadow-sm`)** — Inputs, buttons, brand tiles, brand pill.
- **Card (`shadow-lg`)** — Landing cards and other elevated surfaces.

Cards additionally layer `backdrop-blur` on `bg-white/80` (surface at 80% opacity) for the glassy treatment. This is the signature card look; do NOT swap for opaque `bg-white`. If a surface must be opaque (e.g. because a heavy-motion background would flicker through), justify it in review and add the exception here.

## Shapes

Three radii, mapped to component roles.

- **`rounded.sm` (6px, `rounded-md`)** — Buttons, inputs, brand tile, dismiss buttons. Sharpest interactive radius in the system.
- **`rounded.md` (8px, `rounded-lg`)** — Brand pill, notices. Softer than interactive, less soft than a card.
- **`rounded.lg` (12px, `rounded-xl`)** — Cards. The single largest radius in the product.

`rounded-full` is reserved for avatars and icon-only actions. Do not use it for text buttons or inputs — the brand skews rectangular-with-soft-corners, not pill.

## Components

Frontmatter defines the token-level component contract. This section documents application-level details the tokens can't capture (glass effects, focus rings, loading states, layered SVGs).

### `button-primary`

```
inline-flex items-center justify-center
rounded-md border border-transparent
bg-sky-700 px-4 py-2 text-sm font-semibold text-white shadow-sm
hover:bg-sky-800
focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white
disabled:cursor-not-allowed disabled:opacity-60
```

- Loading state: inline `<Spinner />` + label ("Creating…", "Joining…").
- Disabled at 60% opacity with `cursor-not-allowed`.
- Focus ring uses `focus-visible` — keyboard focus only, not mouse focus.

### `input-text` and `input-code`

```
rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm
placeholder:text-slate-400
focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500
disabled:cursor-not-allowed disabled:opacity-60
```

`input-code` additionally applies `font-mono text-lg uppercase tracking-[0.35em]`. Use it for the 6-character room-code field and any future 6-character token entry (e.g. invite codes).

### `card`

```
flex flex-col gap-4
rounded-xl border border-white/70 bg-white/80 p-5 shadow-lg backdrop-blur
```

The `border-white/70` + `bg-white/80` + `backdrop-blur` triple is the signature glass treatment. All three must be present.

### `brand-tile`

```
size-10 rounded-md border border-white bg-[#FFCC00] shadow-sm backdrop-blur
```

Interior "S" glyph is positioned `left-[5px] top-[-10px]` inside the tile — the crop is intentional (the top of the letter bleeds off the tile). An `sr-only` "Sangai" label sits alongside for screen readers. Do not "fix" the crop.

### `brand-pill`

```
rounded-lg border border-white bg-white/80 px-3 py-1.5 shadow-sm backdrop-blur
font-[family-name:var(--font-outfit)] text-sm text-zinc-900
```

Sits immediately to the right of the brand tile in the landing header. Not used elsewhere.

### `notice-caution`

```
flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900
dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100
role="note"
```

Includes a dismiss button in the notice's own amber scale. Dismissal persists via `localStorage` (see `DRM_DISMISS_KEY` in `src/app/page.tsx`). Screen-reader label required via `aria-label`.

### `landing-hero`

Not a component in the reusable sense — it's the landing `<main>` surface: a three-stop vertical gradient (`#bce8ff → #9adaff → #7dccff`), five layered radial cloud puffs, and a `/public/grass.png` bottom strip repeated horizontally at 56–80px height. The scene is opt-out for dark mode (`[color-scheme:light]`).

### Spinner

Inline SVG, `h-4 w-4 animate-spin`, no external icon library. See `Spinner` in `src/app/page.tsx`. Do not add an icon dependency without a review — a 20-line SVG is cheaper than a package.

## Do's and Don'ts

- **Do** use `bg-white/80 backdrop-blur` for card fills — this is the signature glass treatment.
- **Do** pair every interactive control with a `focus-visible:ring-2` state.
- **Do** render form errors in a `role="status" aria-live="polite"` region with reserved min-height so layout does not jump.
- **Do** provide `sr-only` labels for icon-only or cropped-glyph brand elements.
- **Do** use `[color-scheme:light]` on brand landing/marketing surfaces; provide `dark:` variants on functional room surfaces.
- **Don't** import an icon package (lucide, heroicons, etc.) — inline SVG or nothing.
- **Don't** introduce a fifth font family.
- **Don't** reuse the sky gradient off the landing page.
- **Don't** use opaque `bg-white` on cards — the signature is `bg-white/80 backdrop-blur`.
- **Don't** use `rounded-full` for text buttons or inputs.
- **Don't** invent color tokens outside the palette above. If a new color is needed, add it here first with the specific usage justified.
- **Don't** animate content on first render — motion should confirm a user action, not decorate.
- **Don't** trust user-supplied nicknames as HTML — sanitize before rendering in any surface that shows other users' names (per `CLAUDE.md`).

## Motion

- Loading spinners: `animate-spin` (Tailwind default 1s linear).
- Focus rings: no animation, appear instantly on `:focus-visible`.
- No entrance/exit animations on the landing page. Room-side transitions (screen-share start, participant join) are owned by the LiveKit SDK; do not layer custom transitions on top without a design review.

## Accessibility

Non-negotiable on every new surface:

- All interactive controls have visible focus states via `focus-visible:ring-2`.
- Form errors render inside a `role="status" aria-live="polite"` region with a reserved min-height so appearance does not shift layout.
- Icon-only or cropped-glyph brand elements pair with `sr-only` text labels.
- Notices use `role="note"` and an `aria-label`.
- Nickname is display-only and never trusted — sanitize before rendering user-supplied strings.

## Dark mode

Partial. `globals.css` defines `--background` / `--foreground` for `prefers-color-scheme: dark`. The landing page opts out with `[color-scheme:light]` because the sky+grass scene is a light-only motif. Notices carry `dark:` variants for the room surfaces where dark mode will be honored.

When adding a new surface: if it is a brand landing/marketing surface, opt out of dark mode. If it is a functional room surface, provide `dark:` variants for every non-brand color.

## Open items

- No formal token file (`tokens.json` / `theme.ts`) — the YAML frontmatter above is the token surface. `npx @google/design.md export --format css-tailwind DESIGN.md` will emit a Tailwind v4 `@theme` block if we ever want to unify the two.
- No Storybook or component catalog.
- Room UI (`src/app/room/[code]/*`) has bespoke components (SmartMic, LookAtMe, GamesPanel, etc.) that are not fully audited here — add them to the Components section as they stabilize.
