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

## Cross-Platform Process State Contract (the single source of truth)

> **Post-mortem of `c5266a8` → `26a9039`**: this contract used to live in scattered regex/constant comparisons across three branches. It now lives here and is referenced by all three. If you change a platform branch, update this table first.

The Linux kernel, `ps -o stat=`, and `wsl.exe ps -o stat=` all encode the same state code alphabet. We treat the state code letter as the single decision point:

| State code | Human-readable name(s) | Meaning | Treated as gone? |
|------------|------------------------|---------|------------------|
| `R` | `running` | On CPU | ❌ no |
| `S` | `sleeping` | Interruptible sleep | ❌ no |
| `D` | `uninterruptible sleep` | Disk wait | ❌ no |
| `I` | `idle` | Kernel idle thread (newer kernels) | ❌ no |
| `T` | `stopped` | SIGSTOP / SIGTSTP / SIGTTIN / SIGTTOU | ✅ **yes** |
| `t` | `tracing stop` | `ptrace` stopped (gdb / strace) | ✅ **yes** |
| `Z` | `zombie` | Never reaped | ✅ **yes** |
| `X` | `dead` | Transient state during reaping | ✅ **yes** |

**Crucial asymmetry**: `T` (uppercase) and `t` (lowercase) are different states. `T` is signal-stopped (Ctrl+Z); `t` is debugger-stopped (`ptrace`). A character-only comparison must accept BOTH case values. Comparing against the human-readable name is forbidden — it can be a single word (`stopped`) or multi-word (`tracing stop`), and matching it correctly requires `[\w ]+` or similar — which is harder to keep in sync across branches than the single-letter code.

**Decision function** (target refactor, see "Post-mortem" section below):

```typescript
function isGoneStateCode(c: string): boolean {
  return c === 'T' || c === 't' || c === 'Z' || c === 'X'
}
```

All three platform branches must funnel through this. Today they in-line the same four-character comparison (commit `26a9039`); extracting it is on the roadmap.

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

### Linux / WSL guest — `checkViaProc` (`src/liveness.ts:34`)

1. `process.kill(pid, 0)`:
   - `ESRCH` → return `true` (no such PID).
   - `EPERM` → return `false` (process exists, we just can't signal it — be conservative).
   - success → continue.
2. Read `/proc/<pid>/status`, parse the first non-whitespace character of the `State:` line via `/^State:\s+(\S)/m`. Compare against `{T, t, Z, X}` per the contract above.
3. If `/proc` is unreadable (container PID namespace, etc.), return `false` so the caller falls through to `ps`.

This is the only platform where `SIGSTOP` (Ctrl+Z) and `ptrace` (`strace` / `gdb`) get correctly identified as "gone". The hook may keep writing events for a stopped CLI — those should not be visible in the dashboard because the user can't act on them.

**Why the first-letter parse, not the parenthesized name**: `/proc/.../status` writes `State:\t<T/t/Z/X/...> (<human readable>)`. The human-readable part can be a single word (`stopped`, `zombie`) or multi-word (`tracing stop`). Parsing it requires `\w+` *or* `[\w ]+` depending on context — and historically the codebase had `\w+` which silently dropped multi-word states. Comparing the state code letter is invariant to the human-readable format.

### macOS — `checkViaPsFallback` (`src/liveness.ts:59`)

`ps -o stat= -p <pid>`:

- First character `T`, `t`, `Z`, or `X` → `true` (per the contract above).
- Anything else (`R`, `S`, `D`, `I`, …) → `false`.
- `ps` exit non-zero or empty output → `false` (unknown = alive).

macOS doesn't expose `/proc`, so this is the only path.

### Windows — `checkViaWslOrTasklist` (`src/liveness.ts:75`)

Two sub-tries, in order:

1. `wsl.exe ps -p <pid> -o stat=` — works when the PID is a WSL2 Linux process and the user has WSL enabled. Parse first character same as macOS (including lowercase `t`).
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
| PID in `T` (stopped, signal) | `true` | User paused; can't interact |
| PID in `t` (tracing stop, ptrace) | `true` | Debugger attached; can't interact |
| PID in `Z` (zombie) | `true` | Never reaps; nothing to talk to |
| PID not in `/proc` (ESRCH) | `true` | Gone |

When in doubt, **return `false`**. A stale entry on the sidebar is a minor annoyance; killing a session the user is actively using is a data loss event.

---

## `pruneDeadSessions` — `src/liveness.ts:104`

```text
for s in store.list():
    if s.pid is undefined: skip
    if not isProcessGone(s.pid): skip
    archive sessionsDir/<s.sessionId>.jsonl → .ended/<id>-<now>-<rand8>.jsonl
    store.removeByPid(s.pid)
```

Returns `{ removed: number, archived: string[] }`.

Key invariants:

- **`endedDir = path.join(sessionsDir, '.ended')`** — `mkdirSync(endedDir, {recursive: true})` runs **once before the loop**, not per session (`src/liveness.ts:109`). This was an explicit fix for repeated `mkdirSync` calls eating CPU on the 5s tick; see commit `c5266a8 fix(liveness)`.
- **Same archive format as `hook.sh`**, modulo the suffix choice (kernel PID vs `randomUUID().slice(0,8)`). Both consumers can be in the same `.ended/` directory.
- **Archive failure doesn't block removal.** If `renameSync` throws (locked file, permission denied, etc.), the function still calls `store.removeByPid(s.pid)`. Otherwise a permission error would loop every 5s.
- **Two-clear-path story.** A session can be removed from the store via either `SessionEnd` (`reduce → {kind: 'removed'}`) or `pruneDeadSessions → store.removeByPid`. The store is idempotent — calling `removeByPid` on a PID that's already gone is a no-op.

---

## Notifier ↔ SessionStore Cleanup Wiring (`src/notifier.ts`, `src/stateManager.ts`)

> **Post-mortem of `c5266a8` → `26a9039`**: `Notifier.reset(sessionId)` was deleted in `c5266a8` on the grounds "no caller". The functional role — preventing `lastNotifiedAt` from growing unbounded — was real, just not visible to a caller grep. This section exists so the next person doesn't repeat the mistake.

`Notifier.lastNotifiedAt: Map<sessionId, number>` is used to dedup permission-prompt notifications (`notifier.ts:4`). Without an eviction path, every session ever observed leaves an entry forever.

`SessionStore` exposes an optional `onSessionRemoved?: (sessionId: string) => void` constructor callback (`stateManager.ts:82`). It fires from:

- `apply()` when `SessionEnd` deletes a session that was previously known (`stateManager.ts:94`). **Does not fire** for unknown-session `SessionEnd` — the prev === null short-circuit at `:91` is preserved to handle the chokidar-unlink / prune race.
- `removeByPid()` when a PID-matched session is deleted (`stateManager.ts:127`). Does not fire when no PID matches.

`extension.ts:74` wires `notifier.reset` into the store:

```typescript
const store = new SessionStore((id) => notifier.reset(id))
```

This is the only place the wiring happens. Tests in `stateManager.test.ts` cover all four firing rules (hit / miss / unknown-session / no-callback backward-compat).

---

## Anti-patterns

- **Don't use `child_process.exec`** — the shell interpolation risk is pointless here. `execFileSync('ps', [...], { timeout: 1000 })` is what every branch does.
- **Don't trust `ps -o etime=` for "alive" detection.** A stopped process still has an elapsed time. `stat` is the signal; `etime` is noise.
- **Don't skip the `process.kill(pid, 0)` precheck on Linux** even though `/proc` exists. Container runtimes can let `/proc` reads succeed for an ESRCH PID, which would lead to a confusing "State: ... (running)" parse on garbage content. The precheck fails fast and cleanly.
- **Don't `store.list()` then mutate the store** mid-iteration from anywhere else. `pruneDeadSessions` does both — keep that single-writer contract.
- **Don't compare against human-readable state names** like `'stopped'` / `'tracing_stop'`. They are not stable across kernel versions and not the same alphabet as `ps -o stat=`. Always compare the single-letter state code.
- **Don't delete an API based only on "no direct caller"** without checking: comments referencing it, test fixtures importing it, structural roles it plays (e.g., memory-bound eviction). Grep for the name in all four categories before deleting.

---

## Post-mortem: prevention checklist for future liveness changes

The bug class that triggered this update:

> `c5266a8` was a `fix(liveness)` commit that silently regressed traced-CLI detection on every platform and introduced a `Notifier.lastNotifiedAt` memory leak, because it followed a buggy spec, tested only SIGSTOP (single-word state), and deleted `Notifier.reset` based on a single grep.

Before merging any commit that touches `src/liveness.ts`, `src/notifier.ts`, or the liveness contract in this spec, run this checklist:

- [ ] **Contract table updated first.** If you add/remove/change a state code, update the [Cross-Platform Process State Contract](#cross-platform-process-state-contract-the-single-source-of-truth) table here *before* writing code. Reviewers should reject the diff if the spec didn't change with the code.
- [ ] **Both `T` and `t` covered.** Any new branch that parses a state code must accept both. If you see a `c === 'T'` anywhere without a sibling `c === 't'`, that's the bug.
- [ ] **Multi-word state names tested.** Add or update a test that exercises `t (tracing stop)` content. Existing SIGSTOP tests don't catch this — they always produce single-word `T (stopped)`.
- [ ] **Helper `readProcState` in tests uses the same regex as production.** If they diverge, the test fixture is lying about what the kernel actually returns.
- [ ] **Delete-API structural grep.** Before deleting any method/function: `grep -rn "<name>" src/ .trellis/spec/` and check (1) callers, (2) comments mentioning it, (3) test fixtures, (4) spec docs. If the method played a structural role (eviction, lifecycle hook, invariant), record *why* the role is no longer needed in the commit body — "no direct caller" alone is not enough.
- [ ] **Notifier Map size sanity.** If you touch `notifier.ts`, write or run a test that creates >1000 sessions and verifies `lastNotifiedAt.size` does not grow proportionally. The leak is invisible until weeks of usage.

---

## Verification

```bash
pnpm vitest run src/test/liveness.test.ts
pnpm vitest run src/test/notifier.test.ts
pnpm vitest run src/test/stateManager.test.ts
```

The liveness test file spawns real Node child processes (`src/test/liveness.test.ts:16-34`) to exercise:

- Long-lived child → `isProcessGone` returns `false`.
- `SIGSTOP`'d child → on Linux, `isProcessGone` returns `true`; on other platforms, may return `true` or `false` (the test asserts at least not killing a live one).
- Immediate-exit child → `isProcessGone` returns `true`.
- Non-integer PIDs → all return `false` without throwing.
- **Multi-word state name (`t (tracing stop)`)** — added in `26a9039`, exercises the contract table by mocking `fs.readFileSync` and using `process.pid` (fake pid triggers ESRCH short-circuit before `readFileSync` is called, so the mock is never consumed and pollutes later tests).
- Lowercase `t` from `ps -o stat=` (win32 / darwin branches) — added in `26a9039`.

The Windows branch tests mock `execFileSync` to simulate `wsl.exe` and `tasklist` outputs (`src/test/liveness.test.ts:158-212`). The architecture branch tests (Linux vs macOS vs Windows) are deliberately coarse — the goal is "don't kill the wrong thing", not "kill the right thing on every platform".

The notifier test file uses `vi.useFakeTimers` to test dedup window timing (`notifier.test.ts:1-15`). The `reset()` behavior is covered by tests added in `26a9039`.

---

## Source map

| File | Lines | Role |
|------|-------|------|
| `src/liveness.ts` | 17–28 | Platform router entry |
| `src/liveness.ts` | 34–58 | Linux `/proc` + `process.kill(0)` |
| `src/liveness.ts` | 59–74 | `ps -o stat=` fallback (macOS / Linux fallback) |
| `src/liveness.ts` | 75–103 | Windows `wsl.exe` then `tasklist` |
| `src/liveness.ts` | 104–128 | `pruneDeadSessions` loop |
| `src/notifier.ts` | 1–22 | `Notifier` class with `reset()` |
| `src/stateManager.ts` | 82 | `SessionStore` constructor `onSessionRemoved` |
| `src/stateManager.ts` | 94 | `apply()` fires `onSessionRemoved` on SessionEnd |
| `src/stateManager.ts` | 127 | `removeByPid()` fires `onSessionRemoved` |
| `src/extension.ts` | 65–76 | Wires `notifier.reset` into `SessionStore` constructor |
| `src/test/liveness.test.ts` | — | E2E with real child processes + mocked `/proc` |
| `src/test/notifier.test.ts` | — | Fake-timer dedup + `reset()` semantics |
| `src/test/stateManager.test.ts` | — | `onSessionRemoved` firing rules |