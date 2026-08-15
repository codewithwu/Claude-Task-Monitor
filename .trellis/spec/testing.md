# Testing: vitest with real child processes

> Unit tests are plain vitest. Liveness and hook tests spawn real OS processes. Integration tests live under `src/test/integration/` and run via `@vscode/test-electron` (excluded from the default vitest run).

---

## Conventions

- **Framework**: vitest 1.6. `pnpm test` → `vitest run`. Watch with `pnpm test:watch`.
- **Files**: `src/test/*.test.ts` mirror the source file (`stateManager.test.ts` for `stateManager.ts`).
- **Environment**: `node` (no jsdom). The extension is a Node process; no DOM.
- **Mocking**: minimal. The codebase prefers real child processes over mocks for anything time-sensitive (liveness, hook).
- **Test names**: describe by behavior, not by file path. `describe('isProcessGone 平台路由', ...)` over `describe('liveness.ts', ...)`.
- **`as any` is fine in tests.** The reducer's input shape is loose (we receive `parsed: unknown` from the watcher); tests assert on behavior, not on exhaustive typing. See `src/test/liveness.test.ts:57-60`.

---

## What gets mocked

| Mocked | Why | Where |
|--------|-----|-------|
| `execFileSync` from `node:child_process` | Windows-branch tests for `isProcessGone` need to simulate `wsl.exe` and `tasklist` outputs without a real Windows host | `src/test/liveness.test.ts:9-12` |
| `process.platform` | Same — set `win32` to exercise the Windows branch on Linux CI | `src/test/liveness.test.ts:166-170` |
| nothing else | Liveness tests use real Node child processes; hook tests invoke the real `bash resources/hook.sh`; everything else is plain vitest | — |

`vi.mock` calls must come before the `import` of the module they mock. vitest hoists them, but the codebase uses an explicit pattern (`src/test/liveness.test.ts:9-14`):

```ts
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) }
})

import { isProcessGone, pruneDeadSessions } from '../liveness'
```

### Don't mock these

- `fs` — `stateManager`, `watcher`, `installer`, and `liveness` all interact with the filesystem. Tests use real `mkdtempSync` and `rmSync`.
- The watcher (`chokidar`) — there's no `chokidar` mock. The watcher test uses a real `mkdtempSync` directory.
- VS Code APIs — none are touched by unit tests. TreeDataProvider rendering is implicit (no test file currently); notifier tests pass a plain callback.

---

## Real child processes — `src/test/liveness.test.ts`

Helpers at the top of the file:

- `spawnLongLived()` — spawns `node -e "setInterval(()=>{}, 1000)"`. Returns `{ child, pid, kill, stop, cont }`. `kill` sends SIGKILL, `stop` sends SIGSTOP, `cont` sends SIGCONT.
- `spawnImmediate()` — `node -e "process.exit(0)"`. Returns the PID. Used to simulate a CLI that died after sending `SessionStart`.
- `readProcState(pid)` — reads `/proc/<pid>/status` and returns the `(\w+)` after `State:`. Used to gate assertions on whether we're on Linux.

The tests assert **two tiers**:

1. **Behavior that's always true**: dead PIDs get pruned, alive PIDs don't, empty stores don't throw, non-integer PIDs return `false`. These work on any platform.
2. **Linux-specific behavior**: SIGSTOP'd processes are detected as gone. Gated by `if (procState === 'stopped' || procState === 'tracing stop') { ... } else { expect at least not killing a live one }` (`src/test/liveness.test.ts:112-124`).

### Timeouts

Real process tests need longer than the default 5s. Tests use `it(..., 10000)` or `15000`. Don't shorten them — the child `setInterval` start takes ~200ms, and `livenessCheckIntervalMs` defaults to 5000ms.

### Cleanup

Every test that creates a child process or temp directory must clean up:

```ts
await alive.kill()
fs.rmSync(dir, { recursive: true, force: true })
```

Forgetting the cleanup leaves orphan `node` processes on the test machine. The vitest run itself doesn't kill them. See [[test_conventions]].

---

## Hook tests — `src/test/hook.test.ts`

These are the only tests that touch the **real** `~/.claude-task-monitor/sessions/` directory. They:

1. Spawn a transient Node wrapper that pipes a payload into `bash resources/hook.sh`.
2. Wait 500–800ms.
3. Read the resulting `<sessionId>.jsonl` from the real sessions dir.
4. Assert on the captured `pid` and on the archived filename in `.ended/`.

### Skip-on-non-Linux behavior

The PID-walking tests use `/proc/<pid>/comm`, which is Linux-only. They guard with:

```ts
if (!setSelfComm('claude')) {
  console.warn('无法修改 /proc/self/comm,跳过该测试(非 Linux)')
  return
}
```

`setSelfComm` writes to `/proc/self/comm` (actually `/proc/<pid>/comm` where pid is the test process). If the write fails (no `/proc`, permission denied), the test is silently skipped. Don't replace this with `it.skipIf(...)` — that'd still register the test name in the output and confuse the test runner.

### Session-file cleanup — `src/test/hook.test.ts:46-60`

Every hook test must `cleanup()` its session file. Without this:

- The session file stays in `~/.claude-task-monitor/sessions/` and shows up in your real extension sidebar between test runs.
- The `.ended/` directory accumulates files.

If you run `pnpm test` and notice leftover sessions, the cleanup helper was bypassed. See [[test_conventions]].

---

## Integration tests — `src/test/integration/`

Run via `pnpm test:integration`. This:

1. `pnpm build` (tsup → `dist/`).
2. `pnpm build:integration` (tsc → `dist-test/`).
3. `node ./dist-test/runTest.js` — downloads VS Code, launches it, runs `src/test/integration/suite/e2e.test.ts` inside.

These tests are slow (~30s) and require network access for the VS Code download. Excluded from the default vitest config (`vitest.config.ts`):

```ts
exclude: ['src/test/integration/**']
```

Use integration tests only for behavior that requires the VS Code host (extension activation, view registration, command palette). Everything else should be a unit test.

---

## File checklist for a new module

Adding a new source file `foo.ts`? Add `src/test/foo.test.ts` with at least:

- One "happy path" test.
- One "edge case" test (empty input, missing field, error path).
- One "doesn't mutate what it shouldn't" test if the module owns state.

Don't write a test that calls every public method. Write a test that proves a behavior. If a test reads like the source file restated, delete it.

---

## Quick reference

```bash
pnpm test                                       # all unit tests
pnpm vitest run src/test/stateManager.test.ts   # one file
pnpm vitest run -t "status transitions"          # by test name
pnpm test:integration                           # full e2e in VS Code host
```

Verification command for any spec rule touching behavior:

```bash
pnpm test && pnpm build
```

If both pass, the change is shippable. Integration tests are gated on CI; not every change needs to run them locally.