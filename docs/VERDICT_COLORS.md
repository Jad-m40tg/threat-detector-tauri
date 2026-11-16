# Verdict colors — Phase 1 (data layer)

Controls the gradient tint only of the 4 verdict states. Ring, label, border and
text colors are NOT affected. UI picker comes in Phases 2–3.

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
  - `#result-panel[data-risk="low|medium|high|unverified"]` — dashboard verdict
    card; maps `--risk-color` to `var(--vs-*)`.
  - `.modal-detail[data-risk="…"]` — shared details modal (dashboard + history).
  - NOT covered (user sketch 2026-11-16: only the analysis-details cards are
    targets): `.batch-row` CSV rows keep the engine `--risk-rgb` gradient and
    border — they do NOT follow `--vs-*` overrides; `.batch-tally-dot` header
    dots (solid, not a row gradient).

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

## Settings UI (Phase 3)
Settings → "Verdict colors": 8 swatch buttons (light/dark × 4 verdicts) show the
effective color and open the shared modal (DAC.ui.modal) holding the real
details card (DAC.ui.detailsCard + attachDetailVisuals), the shade picker
(maxSat .3 for Not verified) and Apply/Reset. Drafts set `--vs-<verdict>` on the
scoped preview container only; Apply saves via `verdictShade.set`, Reset/Reset
all restore defaults. The preview shows the edited theme via
`[data-theme-scope=…]` selectors added next to the theme token blocks
(core.css + risk-glow.css).
