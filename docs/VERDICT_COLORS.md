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

## Settings UI (Phase 3, reworked in the verdict-colors FIX)
Settings → "Verdict colors": 8 swatch buttons (light/dark × 4 verdicts) show the
effective color and open the shared modal (DAC.ui.modal) with:

- **Real dashboard card** (`TD.components.verdictCard`, `css/components/
  verdict-card.css`) inside `card result-panel verdict-card` — the same markup
  source the dashboard boots with, built per verdict with exact engine sample
  strings. Preview copies use `{ ids: false }` so ids stay unique in one
  document. The card gets the same ≤600px treatment the card has on phones
  (labels stack above values, ring gets its own strip) because the picker
  column is ~430px — see `.vs-modal .verdict-card` in `css/pages/settings.css`.
- **Thumbnails** — scaled REAL renders (`transform: scale()`, width derived
  from the live stage width so a thumb is an exact copy of the big preview),
  fixed-size `.vs-thumb-shot` wrapper with `pointer-events:none` and
  `aria-hidden` inside, verdict title as visible text, real `<button>` with
  aria-label; clicking one swaps the big preview with a ~200ms cross-fade.
- **Shade picker** (maxSat .3 for Not verified) + Current/Selected dots +
  Apply/Reset. Drafts set `--vs-<verdict>` on the scoped preview container
  only; Apply saves via `verdictShade.set`, Reset/Reset all restore defaults.
- Scope: `[data-theme-scope=…]` mirrors the edited theme's tokens onto the
  preview container (core.css + risk-glow.css), so text/bullets stay readable
  when editing the opposite theme.

Nothing is saved before Apply (the picker's onChange only updates the draft +
preview); the saved value survives reload. Verified: the preview card matches
the dashboard card on computed styles (background, ::after border, radius,
padding, label/dt/dd/reason colors, ring size) in both themes for all 4
verdicts.
