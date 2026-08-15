# State: reducer, store, and bootstrap

> All session state lives in `SessionStore`. Status transitions live in `reduce()`. Nothing else mutates `SessionState`.

---

## Files

- `src/types.ts` — `HookPayload`, `SessionState`, `SessionStatus`, `ReduceResult`
- `src/stateManager.ts` — pure `reduce()` + stateful `SessionStore` class
- `src/test/stateManager.test.ts` — reducer rules

---

## Type Sketches

```ts
// src/types.ts
export type SessionStatus = 'idle' | 'running' | 'waiting'

export interface SessionState {
  sessionId: string
  cwd: string
  status: SessionStatus
  stateChangedAt: number   // epoch seconds; only updated when status changes
  lastUserPrompt: string   // truncated to MAX_PROMPT_LEN (60)
  currentTool: { name: string; input: unknown } | null
  fileOffset: number       // watcher cursor (bytes consumed)
  pid?: number             // CLI process PID; populated from hook.sh
}

export type ReduceResult =
  | { kind: 'updated'; state: SessionState }
  | { kind: 'removed' }    // SessionEnd
```

`MAX_PROMPT_LEN = 60` is a private const in `stateManager.ts`. If you need to surface the full prompt in the tree tooltip, do that at render time, not by widening the field — it bloats the Map for every session.

---

## Reduce Rules

The reducer lives at `src/stateManager.ts:27`. Every transition is one of:

| Event | Resulting `status` | Other changes |
|-------|-------------------|---------------|
| `SessionStart` | `idle` (re-init; carries `pid` + `fileOffset`) | reset `currentTool`/`lastUserPrompt` |
| `UserPromptSubmit` | `running` | `lastUserPrompt = user_prompt.slice(0, 60)` |
| `PreToolUse` | `running` | `currentTool = { name, input }` |
| `PostToolUse` | `running` | `currentTool = null` |
| `Notification` with `notification_type: 'permission_prompt'` | `waiting` | — |
| other `Notification` | unchanged | unchanged |
| `Stop` | `idle` | `currentTool = null` |
| `SessionEnd` | — (returns `{ kind: 'removed' }`) | removed from store |
| anything else | unchanged | unchanged |

Two details that matter:

1. **`stateChangedAt` only updates when `status` actually changes** (`src/stateManager.ts:18-25`). A `PostToolUse` while `running` should not reset the timer — the duration display would jump to 0s.
2. **`pid` is sticky and updated on every event that carries one**, not just `SessionStart` (`src/stateManager.ts:32-36`). The hook currently sends it on every event for safety; if you ever change the hook to only send it once, the reducer already handles late-arriving pids.

---

## `SessionStore` Contract

Defined at `src/stateManager.ts:78`. Behavior:

- **Backing storage**: `Map<sessionId, SessionState>`.
- **`apply(event)`** is the only entry point for new events. Calls `reduce(prev, event)`. If the result is `removed` and `prev` was `null`, no-op (don't emit). If `result.state` is the same reference as `prev`, also no-op — this is how the "non-permission Notification / unknown event" path stops a notification storm.
- **`list()`** returns `Array.from(map.values())` sorted by:
  1. status priority — `waiting < running < idle` (lower = more urgent, top of list)
  2. then `stateChangedAt` descending (most recent transition first within a status)
- **`removeByPid(pid)`** is the liveness path. It searches by PID, not session ID, because the session ID may already be gone from the store but a stale watcher event might re-create it.
- **`onChange(fn)`** registers a listener. Listeners fire synchronously after `apply()` mutates state.

### Anti-patterns

- **Don't read-then-write outside `apply()`**. The store assumes single-writer semantics; reaching into `sessions` from a watcher or tree provider breaks the no-op dedup.
- **Don't store `ReduceResult`**. Always go through `apply()` so listeners fire.
- **Don't widen the status enum** without updating `STATUS_PRIORITY` and the `STATUS_ICON` / `STATUS_LABEL` tables in `treeDataProvider.ts`. Three files must move together.

---

## Bootstrap on Activate

`src/extension.ts:160-180` `bootstrapExistingFiles()`:

1. `fs.readdirSync(SESSIONS_DIR).filter(n => n.endsWith('.jsonl'))`
2. For each file, read the full contents, split by `\n`, run every line through `store.apply()`. Parse failures are warned and skipped, not thrown.
3. `watcher.setOffset(file, Buffer.byteLength(content, 'utf8'))` — the watcher treats those bytes as already-consumed so it doesn't re-emit them as `line` events.

This is the only place a session file is read in bulk. After bootstrap, the watcher handles all incremental updates.

If you change the on-disk format (see `ingest.md`), update the parse branch in `bootstrapExistingFiles()` in the same commit. They share the same JSON parsing assumptions.

---

## Status Transition Visualisation

```
                  ┌────────────────────────────────────┐
                  │                                    │
       SessionStart                                SessionEnd → removed
            │                                         ▲
            ▼                                         │
          idle ◄──────── Stop ──────► running         │
            ▲                          │              │
            │                          ├── PreToolUse ─┤
            │                          ├── PostToolUse ─┤
            │                          │              │
            │                          ▼              │
            │     ┌────── Notification(perm) ─────► waiting
            │     │                                  │
            │     ◄────── (grant, then Stop) ────────┘
            │
            └── UserPromptSubmit ──► running
```

`waiting` is reachable only via `Notification` with `notification_type: 'permission_prompt'`. There is no direct idle→waiting transition; the session must be running and currently invoking a tool. If a permission prompt fires while idle (shouldn't happen, but if `hook.sh` reorders events), the reducer still transitions — that's fine.

---

## Verification

- `src/test/stateManager.test.ts` covers reduce rules, the `removeByPid` path, and the no-op dedup.
- A new status enum value or transition rule needs at least one unit test in the same commit.

Quick check:

```bash
pnpm vitest run src/test/stateManager.test.ts
```