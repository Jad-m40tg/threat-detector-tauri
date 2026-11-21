# AI overview

Optional, secondary explanation of a scan result. The rule-based verdict is
final; AI text never changes a risk level or status.

## Modes

`td.ai.mode` (Settings, default `auto`): `off` (no button, no calls), `click`
(button after a scan, user opens it), `auto` (background call once the result is
final). Available only when mode is not `off`, consent is accepted, and some
provider has a saved key; otherwise there is no button and no nagging. One
overview per single scan; one per CSV batch after it ends. Each new scan resets
the card, and late responses for older scans are ignored via a per-scan token.

## IPC (Tauri commands)

| Command | Arguments | Returns |
|---|---|---|
| `ai_get_status` | - | `{providers[], consentGiven, available}` |
| `ai_save_settings` | `{patch: {provider, apiKey, baseUrl, model, consent}}` | status |
| `ai_clear_key` | `{provider}` | - |
| `ai_test_connection` | `{provider}` | `{ok, message, model}` |
| `ai_overview` | `{request: {scope, payload}}` | `{headline, summary, explanation, tips, provider, model}` |

Provider states: `ready`, `no_key`, `cooling` (with `cooldownUntil`),
`invalid_key`, `daily_cap`. Errors reject with `{code, message,
retryAfterSeconds?}`; code is one of `Disabled`, `NoKey`, `NoConsent`,
`AllProvidersFailed`, `DailyCap`, `Timeout`, `Network`, `Unauthorized`,
`BadResponse`, `Rejected`. Messages are short and friendly; raw provider text is
never shown.

## Payloads and privacy

Single scan: type, content truncated to 600 chars, risk, score, status and
reason, plus up to 10 triggered rules. CSV batch: counts per risk, top Not
Verified reasons, top 5 rules; no raw rows. Untrusted content is fenced in
`<untrusted_content>` after `<`/`>` are replaced, and the system prompt says it
is data, not instructions. Exact Settings notice: when enabled, the scanned text
and the scan result are sent to the selected provider; free tiers may use that
data to improve their products; do not use the feature with private or
confidential content. Consent is required before the first call.

## Keys

Keys live only in the Tauri app config directory, outside this repository:
`<app_config_dir>/ai-overview.json`. The file is plain JSON with keys in plain
text; the profile directory is user-scoped. Keys are write-only: never returned
to the front-end, never stored in localStorage, never logged. Status exposes
only the last four characters. Moving keys to the OS credential store is a
future improvement. `ai-overview.json` is git-ignored as a guard.

## Providers and limits

Failover order: Groq (`api.groq.com/openai/v1`), Google Gemini
(`generativelanguage.googleapis.com/v1beta`), then a custom OpenAI-compatible
base URL. Models are auto-selected from `/models` (Groq
`llama-3.3-70b-versatile` first; Gemini Flash-Lite first) and can be overridden.

- One overview at a time; at least 4 s between calls.
- 8 s per attempt, 15 s total, at most 2 providers attempted.
- At most 1 retry per provider on timeout/network/other 5xx.
- 503/overloaded: 30 s cooldown doubling to 5 min; 429: Retry-After or 60 s;
  401/403: key marked invalid until changed.
- Soft daily cap 100 calls per provider, counted locally.
- LRU cache of 100 overviews keyed by scope plus payload hash.

Replies are parsed defensively (fences stripped, extra keys ignored, values
truncated, HTML and control characters removed) and checked against the verdict:
"safe"/"no risk" language is rejected unless the verdict is Low and Verified,
including for Not Verified items.

## Testing the mock

    python -m http.server 8420 --directory src

Open `settings.html?aimock=ok` (or `slow`, `error`, `ratelimit`, `nokey`,
`failover`) and `index.html?aimock=...`, run a scan, open the AI pane. Rust tests
use an in-memory fake transport and never touch the network:
`cargo test -p threat-detector`.
