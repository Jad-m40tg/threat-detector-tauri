# Backend Integration Guide

This document describes how the frontend talks to the real backend (Java bridge or
HTTP), how to switch adapters, and the contracts every side must honor. It is the
deliverable of the Wave 2 Backend agent.

## 1. Adapter selection

`TD.config.backend` (set in `js/core/td-config.js`) picks the adapter. Values:

- `"mock"` (default) — in-browser mock, no network. Used for demos and tests.
- `"bridge"` — Java side pushes data through `TD.bridge.receive(jsonString)`.
- `"http"` — browser `fetch()` against `TD.config.httpEndpoint` (default `/api/analyze`).

Override without editing code:

```js
localStorage.setItem("td_backend", "http");
location.reload();
```

Or set `TD.config.backend = "http"` before the service modules load.

The Hardware Monitor adapter selector lives in `js/services/monitorService.js`
(`TD.services.monitor`); the analysis adapter lives in
`js/services/analysisService.js` (`TD.services.analysis`).

## 2. Event channel — `TD.events`

A tiny pub/sub (no dependencies) defined in `js/core/events.js`:

```js
var off = TD.events.on("analysis:item-done", function (payload) { ... });
TD.events.emit("analysis:item-done", { input, result });
off(); // unsubscribe
```

Channels emitted by the frontend/backend:

| Event | Payload | Source |
|---|---|---|
| `analysis:item-start` | `{ input }` | analysis service |
| `analysis:item-done` | `{ input, result }` | analysis service |
| `analysis:batch-start` | `{ count }` | analysis service |
| `analysis:batch-done` | `{ count, results }` | analysis service |
| `analysis:result` | normalized result | bridge (`TD.bridge.receive`) |
| `monitor:snapshot` | `Snapshot` | bridge (`TD.bridge.receive`) |

## 3. Bridge contract — `TD.bridge.receive(jsonString)`

The Java side calls `TD.bridge.receive(JSON.stringify(msg))`. Accepted messages:

```json
{ "type": "analysis:result", "requestId": "req-42", "result": { ... } }
{ "type": "monitor:snapshot", "snapshot": { "timestamp": 1700000000000, "cpu": {...}, "memory": {...}, "threadPool": {...} } }
```

`requestId` correlates with the `requestId` sent in the `analysis:request` message
posted via `TD.bridge.send`. The frontend never touches the network in bridge mode.

## 4. Result normalization — `TD.utils.normalizeResult`

Every backend result is passed through `normalizeResult` before reaching the UI.
Rules (hard):

- `failure` / `timeout` / `unknown` / missing → `state: "NOT_VERIFIED"`.
- Never `LOW` / `"safe"` for an unknown or failed result. The UI's "safe" badge
  is only ever set from an explicit backend `SAFE` verdict.
- Engine risk groups consumed by the UI: `THREAT` | `SAFE` | `NOT_VERIFIED`.

## 5. Analysis service API

```js
TD.services.analysis.analyze(input, opts)        // -> Promise<Result>
TD.services.analysis.analyzeBatch(inputs, opts)  // -> Promise<Result[]>
TD.services.analysis.abort()                    // cancels in-flight http requests
TD.services.analysis.backend                   // "mock" | "bridge" | "http"
```

Result shape:

```json
{
  "id": "req-42",
  "input": "http://example.com",
  "state": "THREAT",
  "risk": "high",
  "score": 88,
  "reasons": ["Heuristic hit"],
  "action": "Do not interact",
  "error": null,
  "timestamp": 1700000000000
}
```

## 6. HTTP adapter — errors

- `AbortController` with a per-request timeout (`opts.timeoutMs`, default 15000 ms).
- `429` and `5xx` → `NOT_VERIFIED` (with `error: "HTTP <status>"`), never `SAFE`.
- Network errors / aborts → `NOT_VERIFIED` (state `ERROR`/`TIMEOUT`).
- `analysis.abort()` aborts all in-flight requests.

## 7. Hardware Monitor service contract

`TD.services.monitor = { subscribe(cb) -> unsub, getSnapshot(), startDemoWorkload(taskCount) }`
pushes ~1 Hz while the tab is visible and pauses on `document.hidden`. Real metrics
arrive through `TD.bridge.receive` → `monitor:snapshot`; the mock adapter is used
until the backend is switched.

## 8. Switching guide (mock → real backend)

1. Implement the Java side to call `TD.bridge.receive(JSON.stringify(msg))`.
2. Set `localStorage.setItem("td_backend", "bridge"); location.reload();`.
3. (Or) set `TD.config.backend = "bridge"` before service load.
4. For HTTP mode: point `TD.config.httpEndpoint` at the REST endpoint and set
   backend to `"http"`.
5. Remove / stop loading `js/services/mockMonitorService.js` only after the real
   backend is verified — until then it is harmless (only used when backend="mock").

## 9. Threading notes

- The UI is single-threaded; all backend calls return Promises.
- `TD.bridge.receive` is safe to call from any thread that can reach the JS
  context (the Java bridge marshals onto the UI thread).
- Heavy work (parsing, normalization) happens in the adapter; the UI only
  renders normalized results.
- History search is already debounced (220 ms) and row clicks use event
  delegation; scroll/touch listeners are passive where applicable.

## 10. Mock references audit

- `js/services/mockMonitorService.js` is the only definition of the mock.
- `js/services/monitorService.js` selects the adapter by `TD.config.backend`;
  page code (`hardware.js`) only uses `TD.services.monitor`, never the mock directly.
- `hardware.html` loads `mockMonitorService.js` so mock mode works out of the box;
  it is unused (but harmless) when backend != "mock".