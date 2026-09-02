# Architecture

> How the extension's pieces fit together. Read this before making changes that span modules.

---

## Layer View

The extension is a single Node process inside the VS Code host. Layers form a one-way pipeline:

```
┌─────────────────────────────────────────────────────────────────┐
│  resources/hook.sh  (bash, runs inside `claude` per event)      │
│   • reads JSON payload from stdin                                │
│   • walks /proc up to find comm=claude, captures durable PID     │
│   • appends one JSONL line: payload + {ts, pid}                  │
│   • on SessionEnd: renames .jsonl into .ended/                   │
└──────────────────────────────┬──────────────────────────────────┘
                               │ fs writes to
                               ▼
   ~/.claude-task-monitor/sessions/<sessionId>.jsonl
                               │ chokidar watches
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  src/watcher.ts  (typed EventEmitter)                           │
│   • chokidar 'add' / 'change' / 'unlink'                         │
│   • incremental read from byte offset, split by '\n'            │
│   • emit 'line' per parsed JSON object                           │
└──────────────────────────────┬──────────────────────────────────┘
                               │ 'line' events
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  src/stateManager.ts  (pure reducer + in-memory store)          │
│   • reduce(prev, event) → { kind: 'updated', state } | 'removed' │
│   • SessionStore: Map<sessionId, SessionState> + listeners      │
│   • dedupe no-op emissions via reference equality               │
└──────────┬───────────────────────────────────┬──────────────────┘
           │ state changes                     │ (also)
           ▼                                   ▼
   src/treeDataProvider.ts             src/liveness.ts (every 5s)
   (refresh interval 1s)               (process.kill(pid, 0) →
                                        archive if gone)
           │
           ▼
   vscode.window.createTreeView('claudeTaskMonitor.sessionsView')
```

`src/extension.ts` wires every layer in `activate()`. `src/installer.ts` writes `hook.sh` to `~/.claude-task-monitor/` and merges hook entries into `~/.claude/settings.json` with the `_owner: 'claude-task-monitor'` tag so uninstall knows what to remove.

---

## Data Contracts

| Contract | Defined in | Consumers |
|----------|-----------|-----------|
| `HookPayload` | `src/types.ts:1` | produced by `hook.sh`, consumed by `reduce()` |
| `SessionState` | `src/types.ts:26` | produced by `reduce()`, consumed by `treeDataProvider`, `liveness`, `notifier` |
| `ReduceResult` | `src/types.ts:37` | returned by `reduce()`; `{kind: 'updated', state}` or `{kind: 'removed'}` |
| `Settings` | `src/installer.ts:36` | shape of `~/.claude/settings.json` we read/write |

The on-disk JSONL is **append-only** while a session is alive, then renamed into `.ended/` by `hook.sh` on `SessionEnd`. The extension never writes to the active `.jsonl` — only `liveness.ts` moves it into `.ended/` when the CLI process is confirmed gone.

---

## Configuration Surface

`package.json` declares four settings under `claudeTaskMonitor.*`. Read all four in `activate()` (`src/extension.ts:28-32`) and pass them as constructor args:

| Setting | Default | Consumer |
|---------|---------|----------|
| `staleHours` | 24 | `archiveStaleFiles()` at startup |
| `notifyDedupeSeconds` | 30 | `Notifier` constructor |
| `refreshIntervalMs` | 1000 | tree-view refresh interval |
| `livenessCheckIntervalMs` | 5000 | liveness prune interval |

When adding a setting: declare it in `package.json` (`contributes.configuration.properties`), read it in `activate()`, and pass it explicitly to the consumer. Don't `vscode.workspace.getConfiguration()` deep inside a class.

---

## Event Lifecycle (one session)

1. User launches `claude` in `/home/me/proj`. Claude Code fires `SessionStart`.
2. `hook.sh` runs: walks ancestors, finds PID of the durable `claude` process, appends `{hook_event_name:'SessionStart', session_id, ts, pid}` to `~/.claude-task-monitor/sessions/<id>.jsonl`.
3. Extension's chokidar fires `add` → `watcher.readNew()` reads from offset 0 → emits `line` → `stateManager.apply()` calls `reduce()` → store gains entry with `status: 'idle'`.
4. User sends a prompt → `UserPromptSubmit` → `status: 'running'` (with prompt truncated to 60 chars).
5. Claude calls a tool → `PreToolUse` (status stays `running`, `currentTool` set) → `PostToolUse` (`currentTool` cleared, still `running`).
6. Tool requests permission → `Notification` with `notification_type: 'permission_prompt'` → `status: 'waiting'` → `Notifier` fires a warning toast (deduped within `notifyDedupeSeconds`).
7. Tool granted, model returns → `Stop` → `status: 'idle'`, `currentTool: null`.
8. User quits → `SessionEnd` → `hook.sh` moves `.jsonl` into `.ended/`. Chokidar `unlink` → store deletes entry.

If step 7 or 8 never happens (Ctrl+Z, kill, crash): `liveness.ts` finds the PID gone via `isProcessGone()`, moves the `.jsonl` itself, and removes the store entry.

---

## Cross-Module Invariants

These must stay true or the dashboard lies:

- Every status transition goes through `reduce()`. Components never mutate `SessionState` directly. (See `state.md`.)
- The on-disk JSONL and the store are **not** kept in sync by re-reading the file. The watcher appends lines; the store applies them. If they drift, the drift is hidden — see `state.md#bootstrap`.
- `pid` is captured by `hook.sh`, not by the extension. The extension only consumes it. If a future change lets the extension set the PID, it has to re-derive from `/proc` the same way `hook.sh` does — see `liveness.md`.
- The `_owner` tag is the installer's only safety net. Without it, `deactivate()` would delete unrelated hooks. See `lifecycle.md`.

---

## Boundaries That Are Not There

There is intentionally no:

- IPC / network — the extension never opens a port.
- Persisted state — restart and the store is empty until `bootstrapExistingFiles()` replays.
- Cross-platform adapter layer beyond `liveness.ts`. Everything else is plain Node + VS Code APIs.
- Web frontend. The tree view is the UI; status colours come from `ThemeIcon` + `ThemeColor`.

If a change needs any of these, it needs a discussion, not just a patch.

#### Cross-window coordination via lock file (08-31)

The extension host runs once per VS Code window; `Notifier` is process-local, so without coordination the same `waiting` event triggers N toasts for N windows. We elect a single toast emitter per host via a file lock at `~/.claude-task-monitor/notify-leader.lock`.

Properties:

- File-based; no IPC, no network, no port.
- Per-host isolation (`os.hostname()`) — shared `$HOME` across machines (NFS) does NOT suppress notifications on the other host.
- Fail-open: any fs error → `isLeader()` returns true → fall back to "all windows notify" (the pre-feature behavior). Missing a notification is worse than duplicating one.
- Implementation: `src/util/leaderLock.ts`. Gated by `claudeTaskMonitor.notifyLeaderElection`.
- Focus-driven election: the most-recently-focused window holds the lock. Blur stops heartbeats; the lock expires after `STALE_AFTER_MS = 6000` (3× heartbeat) so the next focused window takes over.

This is **not** general cross-process state — it's a single-purpose coordination signal. The `_owner`-tagged settings.json and `muted.json` patterns are unchanged.