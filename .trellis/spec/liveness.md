# Liveness: detecting dead CLI processes

> `src/liveness.ts` is the only module that talks to the OS process table. It must be conservative — false positives (killing a live session) are worse than false negatives (a stale entry).

---

## Two Functions, One File

| Function | Purpose |
|----------|---------|
| `isProcessGone(pid)` | Returns `true` only if the OS confirms the process is dead or unusable. Default `false`. |
| `pruneDeadSessions(store, sessionsDir)` | Iterates the store, archives dead sessions into `.ended/`, removes them from the store. |

`pruneDeadSessions` is called from `extension.ts:110-115` every `livenessCheckIntervalMs` (default 5s). It's also the "owner" of the archive-on-prune convention — `hook.sh` archives on `SessionEnd`, this function archives when the CLI dies without sending one.

---

## Platform Router

`isProcessGone(pid)` (`src/liveness.ts:17`) dispatches by `process.platform`:

```
                ┌──────────────────┐
isProcessGone ─►│ process.platform │
                └────┬─────┬───────┘
                linux│  darwin│  win32
                     ▼        ▼        ▼
              checkViaProc  checkViaPsFallback  checkViaWslOrTasklist
              (+ ps fallback)
```

### Linux / WSL guest — `checkViaProc` (`src/liveness.ts:31`)

1. `process.kill(pid, 0)`:
   - `ESRCH` → return `true` (no such PID).
   - `EPERM` → return `false` (process exists, we just can't signal it — be conservative).
   - success → continue.
2. Read `/proc/<pid>/status`, parse `State:\s+\S+\s+\((\w+)\)`.
3. Return `true` if the state code is one of: `stopped`, `tracing_stop`, `zombie`, `dead`.
4. If `/proc` is unreadable (container PID namespace, etc.), return `false` so the caller falls through to `ps`.

This is the only platform where `SIGSTOP` (Ctrl+Z) gets correctly identified as "gone". The hook may keep writing events for a stopped CLI — those should not be visible in the dashboard because the user can't act on them.

### macOS — `checkViaPsFallback` (`src/liveness.ts:56`)

`ps -o stat= -p <pid>`:

- First character `T`, `Z`, or `X` → `true`.
- Anything else (`R`, `S`, `D`, `I`, …) → `false`.
- `ps` exit non-zero or empty output → `false` (unknown = alive).

macOS doesn't expose `/proc`, so this is the only path.

### Windows — `checkViaWslOrTasklist` (`src/liveness.ts:72`)

Two sub-tries, in order:

1. `wsl.exe ps -p <pid> -o stat=` — works when the PID is a WSL2 Linux process and the user has WSL enabled. Parse first character same as macOS.
2. `tasklist /FI "PID eq <pid>" /NH /FO CSV` — for native Windows PIDs. Output containing `INFO: No tasks` → `true`. Any CSV line with the PID → `false`. Errors → `false`.

Either falling through returns `false` (don't kill).

---

## Conservative Defaults

These rules are why the function is safe to call every 5s on every session:

| Input | Return | Why |
|-------|--------|-----|
| `NaN`, `0`, negative, non-integer, `undefined`, `null` | `false` | Not a process; no-op |
| PID exists, all checks fail (timeout, error) | `false` | Unknown = alive |
| PID in `D` (uninterruptible sleep) | `false` | Short-lived disk waits; don't kill |
| PID in `R`/`S`/`I` | `false` | Running or idle |
| PID in `T` (stopped) | `true` | User paused; can't interact |
| PID in `Z` (zombie) | `true` | Never reaps; nothing to talk to |
| PID not in `/proc` (ESRCH) | `true` | Gone |

When in doubt, **return `false`**. A stale entry on the sidebar is a minor annoyance; killing a session the user is actively using is a data loss event.

---

## `pruneDeadSessions` — `src/liveness.ts:101`

```text
for s in store.list():
    if s.pid is undefined: skip
    if not isProcessGone(s.pid): skip
    archive sessionsDir/<s.sessionId>.jsonl → .ended/<id>-<now>-<rand8>.jsonl
    store.removeByPid(s.pid)
```

Returns `{ removed: number, archived: string[] }`.

Key invariants:

- **`endedDir = path.join(sessionsDir, '.ended')`** — `mkdirSync(endedDir, {recursive: true})` runs **once before the loop**, not per session (`src/liveness.ts:106`). This was an explicit fix for repeated `mkdirSync` calls eating CPU on the 5s tick; see commit `c5266a8 fix(liveness)`.
- **Same archive format as `hook.sh`**, modulo the suffix choice (kernel PID vs `randomUUID().slice(0,8)`). Both consumers can be in the same `.ended/` directory.
- **Archive failure doesn't block removal.** If `renameSync` throws (locked file, permission denied, etc.), the function still calls `store.removeByPid(s.pid)`. Otherwise a permission error would loop every 5s.
- **Two-clear-path story.** A session can be removed from the store via either `SessionEnd` (`reduce → {kind: 'removed'}`) or `pruneDeadSessions → store.removeByPid`. The store is idempotent — calling `removeByPid` on a PID that's already gone is a no-op.

---

## Anti-patterns

- **Don't use `child_process.exec`** — the shell interpolation risk is pointless here. `execFileSync('ps', [...], { timeout: 1000 })` is what every branch does.
- **Don't trust `ps -o etime=` for "alive" detection.** A stopped process still has an elapsed time. `stat` is the signal; `etime` is noise.
- **Don't skip the `process.kill(pid, 0)` precheck on Linux** even though `/proc` exists. Container runtimes can let `/proc` reads succeed for an ESRCH PID, which would lead to a confusing "State: ... (running)" parse on garbage content. The precheck fails fast and cleanly.
- **Don't `store.list()` then mutate the store** mid-iteration from anywhere else. `pruneDeadSessions` does both — keep that single-writer contract.

---

## Verification

```bash
pnpm vitest run src/test/liveness.test.ts
```

The test file spawns real Node child processes (`src/test/liveness.test.ts:16-34`) to exercise:

- Long-lived child → `isProcessGone` returns `false`.
- `SIGSTOP`'d child → on Linux, `isProcessGone` returns `true`; on other platforms, may return `true` or `false` (the test asserts at least not killing a live one).
- Immediate-exit child → `isProcessGone` returns `true`.
- Non-integer PIDs → all return `false` without throwing.

The Windows branch tests mock `execFileSync` to simulate `wsl.exe` and `tasklist` outputs (`src/test/liveness.test.ts:158-212`). The architecture branch tests (Linux vs macOS vs Windows) are deliberately coarse — the goal is "don't kill the wrong thing", not "kill the right thing on every platform".

---

## Source map

| File | Lines | Role |
|------|-------|------|
| `src/liveness.ts` | 17–28 | Platform router entry |
| `src/liveness.ts` | 31–53 | Linux `/proc` + `process.kill(0)` |
| `src/liveness.ts` | 56–68 | `ps -o stat=` fallback |
| `src/liveness.ts` | 72–97 | Windows `wsl.exe` then `tasklist` |
| `src/liveness.ts` | 101–126 | `pruneDeadSessions` loop |
| `src/test/liveness.test.ts` | — | E2E with real child processes |