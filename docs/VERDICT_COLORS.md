# Verdict colors — Phase 1 (data layer)

Controls the gradient tint only of the 4 verdict states. Ring, label, border and
text colors are NOT affected. UI picker comes in Phases 2–3.

## The shared verdict card (verdict-colors FIX)
One markup source for every result card: `js/components/verdictCard.js`
(`TD.components.verdictCard.render(host, verdict, data, opts)`) +
`css/components/verdict-card.css` (card styles + the single `--vs-*` tint
block). The dashboard's three static shells are replaced with builder markup at
boot and `presentResult` fills through the builder (ids kept); the Settings
preview builds the same markup with `{ ids: false }`. History/`.modal-detail`
does NOT use this component and stays shade-immune.

## Storage keys (TDSettings; overrides only — absent key = default)
| Theme | High | Medium | Low | Not verified |
|---|---|---|---|---|
| light | `td.vs.light.high` | `td.vs.light.medium` | `td.vs.light.low` | `td.vs.light.unverified` |
| dark  | `td.vs.dark.high`  | `td.vs.dark.medium`  | `td.vs.dark.low`  | `td.vs.dark.unverified`  |

Values: lowercase `#rrggbb` (or `""` = unset). "dark" is one setting shared by
every dark variant (grey / OLED). Registered in `js/settings.js` (`hex: true`).

## CSS variables (defined in `css/risk-glow.css`)
- `--vs-high` / `--vs-medium` / `--vs-low` / `--vs-unverified` — effective tint
  per current theme.
- `--vs-<verdict>-<theme>-o` — JS override variables (e.g. `--vs-high-light-o`)
  set on `document.documentElement` by `DAC.verdictShade`; removed on reset.
- Gradient alphas (shared by the verdict card and the details modal):
  dark `--risk-edge-a: .22` / `--risk-corner-a: .10` / `--risk-border-a: .35`;
  light `.50` / `.30` / `.55` — raised four times after user reports
  (`.12/.06/.25` → `.16/.08/.28` r2 → `.28/.14/.40` r3 → `.34/.20/.46` r4 →
  current, r5: "increase the gradient color strength more... still feel
  barely visible" — deliberately bold so the tint registers even on a
  low-contrast laptop panel). Light far exceeds dark by design: a white
  surface needs much more. Text stays AA-safe (worst case ≈10:1).
  Additionally (r4, raised in r5) the LIGHT verdict card's base surface
  carries a permanent 10% risk-color mix over `--bg-card`
  (verdict-card.css, scoped to light + `[data-theme-scope=light]`) — the
  whole card clearly reads tinted (light high ≈ `#F9E9EC`), not white.

## Selectors
- Defaults: `:root` (dark) and `:root[data-theme="light"]` (light).
- Consumers (gradient tint only; stops/geometry unchanged, color via
  `color-mix(in srgb, var(--risk-color) P%, transparent)`):
  - `.verdict-card[data-risk="low|medium|high|unverified"]` — the verdict result
    card (`css/components/verdict-card.css`, one tint block reading only
    `--vs-*`). On the page this is `#result-panel` (which carries the
    `verdict-card` class); the Settings preview renders the same class.
  - `.batch-row[data-risk="…"]` — CSV batch rows follow the shades too
    (`--risk-color` maps to `var(--vs-*)`, same color-mix gradient); their
    border/separator colors keep the engine values.
- NOT covered (deliberately):
  - `.modal-detail[data-risk="…"]` — shared details modal (dashboard + history)
    keeps the engine `--risk-rgb` radial tint; shades must not reach it.
  - `.batch-tally-dot` header dots (solid, not a row gradient).

## Defaults
| Theme | high | medium | low | unverified |
|---|---|---|---|---|
| dark | `#ff5a5f` | `#ffb020` | `#3ddc84` | `#8a93a0` |
| light | `#c2263b` | `#b45309` | `#127a48` | `#55606a` |

## API — `DAC.verdictShade` (js/core/core.js)
- `get(theme, verdict)` → effective hex (override if set, else default)
- `set(theme, verdict, hex)` → bool; accepts `#RGB` / `#RRGGBB`, `#` optional,
  case-insensitive; stores lowercase `#rrggbb`; invalid input rejected
- `reset(theme, verdict)` / `resetAll()` → restore defaults
- `isCustom(theme, verdict)` → true only if a stored override ≠ default
- `defaults(theme, verdict)` → default hex
- `onChange(fn)` → fn receives `{ theme, verdict, value }`; returns unsubscribe
Invalid theme/verdict args return `null`/`false` (never throws). Overrides are
applied to `<html>` at load (end-of-body core.js — earliest the script-order
contract allows; theme-init.js must not read `td.*` keys).

## Settings UI (Phase 3, reworked in the FIX + the user's sketch rounds 2 and 3)
Settings → "Verdict colors": 8 swatch buttons (light/dark × 4 verdicts) show the
effective color and open the shared modal (DAC.ui.modal) with:

- **Compact preview card** (sketch round 2): the big preview is the REAL card
  component (`TD.components.verdictCard` with the new `opts.compact` flag) —
  only the prominent verdict label + Selected input + Risk score + ring; the
  muted "Analysis details" heading and the reasons/action rows are omitted
  (unverified keeps "Unable to verify" + Reason). The modal is 1000px wide,
  putting the preview column at ~505px (`.modal-vs` + `.vs-modal` in
  `css/pages/settings.css`), so the card uses its natural ≥600px treatment:
  rows stack label-above-value (scoped `.detail-rows` override) and the ring
  parks top-right BESIDE the content (`padding-right:132px`, no 108px strip).
  Width-invariant styles (tint, border, radius, colors, ring size) still match
  the dashboard card 8/8.
- **Thumbnails** (user round 3) — "the other verdicts:" as a prominent bold
  heading, then ALWAYS three thumbs: the three verdicts that are NOT
  selected (`vsThumbKeys()` — sketch slots `unverified → medium → low` with
  the SELECTED verdict's slot replaced by `high`, so high selected reads
  unverified/medium/low and e.g. medium selected reads unverified/high/low).
  Grid fixed `repeat(3, minmax(0,1fr))`. Each thumb is a COMPACT mini copy
  of the big preview: the same `TD.components.verdictCard` `compact:true`
  render the stage shows, laid out at the stage width with the stage's
  ≥600px treatment (`padding-right:132px` ring zone — the old 108px thumb
  ring-strip rule was removed), with the ring/check/dashed-ring visual
  MOUNTED (`vsModal.thumbVis` handles, destroyed on every re-render and in
  `vsCloseModal`; mounted BEFORE the height pass — the low card's check
  circle is in-flow), then shrunk with `transform:scale()`. Two-phase
  render (mount buttons → settled grid → one scale from the measured cell,
  ≈0.2819 at the 1000px modal's 505px stage → ~142×90 shots). Uniform size:
  every card's stacked states get the TALLEST state's height before
  scaling, so all three thumbs are identical (~160×138 buttons / 142×90
  shots). Titles stay visible text; inside the wrapper
  `pointer-events:none` + `aria-hidden`; clicking swaps the big preview
  with a ~200ms cross-fade.
- **Dev-mode note** (sketch): below the thumbnails in the left column, always
  visible — the shared `.callout[data-type="info"]` style + ⓘ icon
  (`DAC.ui.callouts.upgrade` paints it right after the modal opens), text
  "Note: this feature is dev mode only".
- **Shade picker** (320px square, maxSat .3 for Not verified) + Current/
  Selected dots + Apply/Reset. Drafts set `--vs-<verdict>` on the scoped
  preview container only; Apply saves via `verdictShade.set`, Reset/Reset all
  restore defaults.
- Scope: `[data-theme-scope=…]` mirrors the edited theme's tokens onto the
  preview container (core.css + risk-glow.css), so text/bullets stay readable
  when editing the opposite theme.

Nothing is saved before Apply (the picker's onChange only updates the draft +
preview); the saved value survives reload. Verified: the preview card matches
the dashboard card on computed styles (background, ::after border, radius,
padding, label/dt/dd/reason colors, ring size) in both themes for all 4
verdicts. Round 3 verified: thumbs always exactly 3 + identical size (after
picking medium the row reflows to unverified/high/low, still 3), compact mini
copies with the ring visual mounted; the light gradient is visible on the big
card AND every thumb for all 4 verdicts (alphas .16/.08, border .28).
