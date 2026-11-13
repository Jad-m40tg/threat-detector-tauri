# IPC Contract — Threat Detector (Tauri v2 + Rust)

This document is the authoritative specification for all communication between the HTML/JS frontend and the Rust backend.
All JSON payloads transmitted across the IPC boundary strictly use **camelCase**.

---

## 1. Tauri Commands

All commands are exposed via Tauri's IPC invoker: `window.__TAURI__.core.invoke(commandName, args)`.

### 1.1 `analyze_item`
Analyzes a single URL or text message synchronously.

- **Parameters:**
  ```json
  {
    "request": {
      "id": "optional-string-id",
      "inputType": "url | message | null",
      "content": "https://example.com"
    }
  }
  ```
- **Returns:** `Promise<IpcAnalysisResult>`
- **Errors:** Returns a string error description only if IPC serialization fails. Analysis errors return a valid `IpcAnalysisResult` with `riskLevel: "NotVerified"`.

---

### 1.2 `analyze_csv`
Starts a multi-threaded batch scan of a CSV file. Returns immediately with the batch identification and total item count. Items are streamed progressively via events.

- **Parameters:**
  ```json
  {
    "path": "C:\\path\\to\\file.csv",
    "options": {
      "minItemDurationMs": 15,
      "concurrency": 8
    }
  }
  ```
- **Returns:**
  ```json
  {
    "batchId": "batch-1700000000",
    "total": 10
  }
  ```
- **Errors:** Returns a typed rejection if the file does not exist, exceeds 1 MB, or contains no readable rows.

---

### 1.3 `cancel_batch`
Requests immediate cooperative cancellation of an in-flight batch.

- **Parameters:**
  ```json
  {
    "batchId": "batch-1700000000"
  }
  ```
- **Returns:** `boolean` (`true` if batch was found and cancel signal sent).

---

### 1.4 `pick_csv`
Opens the native Windows file picker (`IFileDialog`) from Rust. The frontend needs zero file-system permissions.

- **Parameters:** none
- **Returns:** `string | null` (The absolute path selected by the user, or `null` if cancelled).

---

### 1.5 `analyze_csv_content` *(added by decision D7)*
Analyzes CSV content supplied directly by the frontend: drag-and-drop gives the
WebView a `File` object with no filesystem path, so the bytes are read in JS and
sent as text. Identical streaming behavior and limits as `analyze_csv` (1 MB /
5,000 rows, typed rejections).

- **Parameters:**
  ```json
  {
    "name": "stress_500.csv",
    "content": "url\nhttps://example.com\n...",
    "options": { "minItemDurationMs": 60, "concurrency": 8 }
  }
  ```
- **Returns:** the same `{ "batchId": "...", "total": N }` shape as `analyze_csv`.
- **Errors:** typed rejection on empty content, size > 1 MB, or more than 5,000 rows.

---

## 2. Real-Time Streaming Events

Emitted from backend to frontend and bridged to `TD.events`:

| Event Name | Payload | Frequency / Trigger |
|---|---|---|
| `analysis:item-start` | `{ "id": "1", "input": "..." }` | When worker task begins processing an item |
| `analysis:item-done` | `{ "input": "...", "result": IpcAnalysisResult }` | When worker finishes an item |
| `analysis:progress` | `{ "batchId": "...", "done": 4, "total": 10, "pct": 40 }` | Throttled (~40 ms interval) |
| `analysis:batch-done` | `{ "batchId": "...", "count": 10, "results": [ ... ] }` | When all workers complete |

---

## 3. Data Shapes

### `IpcAnalysisResult`
```typescript
interface IpcAnalysisResult {
  id: string;
  inputType: "url" | "message";
  input: string;
  riskLevel: "Low" | "Medium" | "High" | "NotVerified";
  risk: "low" | "medium" | "high" | "unverified";
  state: "SAFE" | "THREAT" | "NOT_VERIFIED";
  score: number | null; // null when NotVerified
  status: "verified" | "not_verified" | "error";
  category: string;
  details: string;
  reasons: string[];
  triggeredRules: Array<{
    id: string;
    description: string;
    points: number;
  }>;
  recommendation: string;
  error: { kind: string; message: string } | null;
  durationMs: number;
  ts: number;
}
```

### Invariant Rules
1. If `riskLevel === "NotVerified"`:
   - `score` MUST be `null` (never `0` or default score).
   - `state` MUST be `"NOT_VERIFIED"` (never `"SAFE"`).
   - `risk` MUST be `"unverified"` (never `"low"`).
2. The UI table and cards must never render a `NotVerified` item with green/safe accents.
