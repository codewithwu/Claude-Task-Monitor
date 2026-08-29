# Ingest: hook.sh and watcher

> The protocol between `resources/hook.sh` (writer) and `src/watcher.ts` (reader). Change both sides together.

---

## Two Ends, One Wire Format

```
resources/hook.sh  ──JSONL append──►  ~/.claude-task-monitor/sessions/<id>.jsonl
                                              │
                                              ▼ chokidar
                                      src/watcher.ts
                                              │ 'line' events
                                              ▼
                                      stateManager.apply()
```

The on-disk shape is the only contract. If `hook.sh` renames a field, `types.ts` and the reducer have to follow in the same commit.

---

## `hook.sh` — the writer (`resources/hook.sh`)

Run by Claude Code on every hook event. stdin receives a JSON payload, stdout is unused (everything is appended).

### Steps

1. `mkdir -p "$HOME/.claude-task-monitor/sessions"`
2. Parse `session_id` and `hook_event_name` from stdin via `jq`. Empty / missing → `exit 0` (silent skip).
3. **PID walking**: walk up from `$PPID` through `/proc/<pid>/status` looking for a process whose `comm` field is exactly `claude`. The first match is `claude_pid`. If none found, fall back to `$PPID`.
4. Append one line to `<sessionId>.jsonl`:

   ```json
   {"original_payload_fields": "...", "ts": <unix-seconds>, "pid": <claude_pid or $PPID>}
   ```

   The payload is enriched with `ts` (added by `hook.sh` via `now`) and `pid`. Original fields are preserved via jq's `. + {...}`.
5. If `event == SessionEnd`, rename the `.jsonl` into `<sessionsDir>/.ended/<sessionId>-<unix-seconds>-$$.jsonl`. The trailing `$$` (shell PID) prevents same-second collisions when the hook fires multiple times in one second.

### Why PID walking matters

`$PPID` is the immediate parent of the bash subshell that Claude Code spawns to run the hook — typically a Node MainThread that's gone microseconds after the hook returns. Recording that PID would make the liveness check 5s later see `ESRCH` and incorrectly clear the still-running CLI session from the dashboard.

The walk-up rule: `comm == "claude"` matches the durable Claude Code CLI process. Test in `src/test/hook.test.ts:67-99` covers both the ancestor-found and fallback branches.

### jq dependency

`hook.sh` requires `jq` on `PATH`. `extension.ts:37-42` checks with `detectJq()` and shows an error toast if missing. **Never replace `jq` with shell string parsing** — `session_id` and other fields can contain shell-unsafe characters (quotes, backslashes, newlines from user prompts).

### Anti-patterns in `hook.sh`

- Don't `echo "$payload" >>` — use `jq -c` to keep the output single-line and JSON-safe.
- Don't replace `$$` with `$(date +%s%N)` or `randomUUID`. Same-second archive collisions are the failure mode; the kernel PID is free, monotonic, and zero-cost.
- Don't add new exit codes. `exit 0` on missing/invalid payload is intentional — Claude Code treats any hook exit non-zero as an error and may surface that to the user.

---

## `src/watcher.ts` — the reader

Wraps chokidar with an `EventEmitter<WatcherEvents>` typed channel:

```ts
type WatcherEvents = {
  fileAdded: [filePath: string]
  fileRemoved: [filePath: string]
  line: [filePath: string, parsed: unknown]
  parseError: [message: string, filePath: string, line: string]
}
```

### Lifecycle

1. `start()` opens chokidar with:
   - `ignored: p => p.includes(path.sep + '.ended')` — never watch the archive directory; moving files into it would re-fire `add` events.
   - `depth: 1` — no recursion.
   - `awaitWriteFinish: false` — emit immediately on every change; the incremental read below handles partial lines.
   - Resolves the returned Promise on chokidar's `ready` event.
2. `close()` shuts chokidar and clears the in-memory offset map.

### Incremental read (`readNew`, `src/watcher.ts:68-103`)

The trick that makes this work:

- Track `offsets: Map<filePath, byteOffset>` per file.
- On `add`/`change`, `statSync` the file. If `size <= offset`, no-op.
- Open with `fs.openSync(file, 'r')` (sync because we need deterministic ordering), `readSync` exactly `(size - offset)` bytes from `offset`.
- `text.split('\n')`, **pop the trailing element** (it's either empty or a partial line still being written).
- For each complete line, `JSON.parse` and emit `'line'`. On parse failure emit `'parseError'`.
- Update `offsets` to `offset + consumed` where `consumed` is `Buffer.byteLength(line) + 1` per line (the +1 is the `\n`). This is critical: forgetting the +1 makes the next read overlap by one byte and produce duplicate events.

### Truncation recovery (`stat.size < offset`) — 08-29 R3

When `statSync` returns a size smaller than the saved offset (`truncate -s N`, writer-side rollback, partial fsync fail), the naive early-return loses the new content forever — until the file is deleted and recreated.

The fix (in `readNew`):

```ts
let offset = this.offsets.get(file) ?? 0
if (stat.size < offset) {
  // 文件被截断;从头重新读,emit 的事件对 stateManager 是新的
  offset = 0
  this.offsets.set(file, 0)   // 必须同步重置 map,否则下次 change 在 stat.size === offset 时仍会早返
}
if (stat.size === offset) return
```

Two non-obvious points:

1. **Update the offsets map too**, not just the local `offset` var. The map persists across `change` events; without the `set(file, 0)` call, the next change after a `truncate → append` will see `stat.size === offset` and return without reading.
2. **State idempotency**: emitting events from byte 0 of the truncated file may replay lines the stateManager already saw. The reducer is built idempotent-friendly (each event type's reduce returns the same result for the same prev), so duplicate inputs converge. No special signal is needed.

Regression test: `src/test/watcher.test.ts > 文件被截断后从头重新读取,不丢失新内容`.

### Events

| chokidar event | watcher emits | Notes |
|---------------|---------------|-------|
| `add` | `fileAdded` (then `line` × N for current contents) | offset defaults to 0 unless `setOffset()` was called (bootstrap path) |
| `change` | `line` × N for new lines only | same incremental read |
| `unlink` | `fileRemoved` | offset entry dropped |

`extension.ts:89-92` reacts to `fileRemoved` by applying a synthetic `SessionEnd` with `ts = now`, which `reduce()` turns into `{kind: 'removed'}`.

### Anti-patterns

- **Don't use async `fs.promises.read`** in `readNew`. The split-by-`\n` + offset bookkeeping assumes the entire new region is read in one syscall; mixing async reads makes the offset drift.
- **Don't `awaitWriteFinish: true`** — it would batch events and delay the status update, defeating the dashboard's purpose.
- **Don't watch `~/.claude-task-monitor/sessions/.ended/`** — chokidar's `add` on an archive move would loop the extension back into the file. The `ignored` filter is mandatory.
- **Don't change the line format** (`{original_fields + ts + pid}`) without a migration that walks existing `.jsonl` files. Active sessions in flight during the upgrade will land in the store with the wrong shape.

---

## Archive filename format

Both `hook.sh` (SessionEnd) and `liveness.ts` (prune) write into `.ended/` with three-segment names that avoid same-second collisions:

| Source | Format | Example |
|--------|--------|---------|
| `hook.sh` | `<sessionId>-<unix-seconds>-$$.jsonl` | `abc-1739123456-78901.jsonl` |
| `liveness.ts` | `<sessionId>-<Date.now()>-<randomUUID8>.jsonl` | `abc-1739123456789-3f2a91b7.jsonl` |

The two suffixes differ on purpose: `hook.sh` runs inside the user's CLI process (so shell PID is free and unique), `liveness.ts` runs in the extension host (so it uses `randomUUID().slice(0,8)` instead of process PID). Either format is fine — `pruneDeadSessions` doesn't care about the suffix, only the prefix.

---

## Verification

```bash
# End-to-end: hook.sh writes a real .jsonl, watcher reads it
pnpm vitest run src/test/hook.test.ts
pnpm vitest run src/test/watcher.test.ts
```

The hook tests invoke the real `bash resources/hook.sh` via a Node wrapper that writes a payload to its stdin. They require `jq` on PATH and write into the real `~/.claude-task-monitor/sessions/` — see `testing.md#session-file-cleanup`.