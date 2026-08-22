# Claude Task Monitor — Spec Index

> Real codebase-backed guidelines for the Claude Task Monitor VS Code extension.

---

## What This Project Is

A VS Code extension (`codewithwu-cn.claude-task-monitor`) that shows a sidebar dashboard of every local Claude Code CLI session. The CLI is not the extension — `claude` writes JSONL events to `~/.claude-task-monitor/sessions/` via a hook the extension installs; the extension watches that directory and projects session status (`waiting` / `running` / `idle`) into a tree view.

Core motivation (don't lose this when changing things): a developer running multiple `claude` sessions across terminals wants to see which ones are blocked waiting for permission, without opening each one. See `README.md` "设计初心" section and the `origin` memory.

---

## File Layout

```
src/
├── extension.ts              # activate/deactivate, config wiring, hook installer bootstrap
├── types.ts                  # HookPayload / SessionState / ReduceResult / SessionStatus
├── stateManager.ts           # pure reduce() + SessionStore (Map<sessionId, SessionState>)
├── watcher.ts                # chokidar + JSONL incremental read; typed EventEmitter
├── liveness.ts               # isProcessGone() platform router + pruneDeadSessions()
├── notifier.ts               # dedup wrapper around vscode.window.showWarningMessage
├── treeDataProvider.ts       # VS Code TreeDataProvider<SessionState>
├── installer.ts              # ~/.claude/settings.json merge/uninstall with _owner tag
├── util/time.ts              # humanizeDuration(seconds)
└── test/                     # vitest, real child processes
    ├── liveness.test.ts      # spawns real Node children for SIGSTOP / kill cases
    ├── hook.test.ts          # end-to-end: invokes resources/hook.sh via wrapper
    ├── stateManager.test.ts
    ├── watcher.test.ts
    ├── notifier.test.ts
    ├── installer.test.ts
    ├── util.test.ts
    └── integration/          # @vscode/test-electron harness (excluded from vitest)
resources/
└── hook.sh                   # bash: walks /proc/PID/comm looking for `claude`, archives .jsonl
```

Single-process extension — there is no frontend/backend split. The tree view consumes the same in-memory store the watcher feeds.

---

## Guidelines Index

| Guide | Purpose | Read when |
|-------|---------|-----------|
| [Architecture](./architecture.md) | Layer boundaries, data flow, file map | Onboarding, planning cross-module changes |
| [State](./state.md) | `reduce()` rules, status priority, bootstrap, no-op detection | Touching `stateManager.ts` or `types.ts` |
| [Ingest](./ingest.md) | `watcher.ts` JSONL incremental read + `resources/hook.sh` | Changing the on-disk event format |
| [Liveness](./liveness.md) | `isProcessGone()` platform router + archive format | Touching `liveness.ts` or PID-based pruning |
| [Lifecycle](./lifecycle.md) | `extension.ts` activate/deactivate, config, installer, tree UI, notifier | Adding a config key, view, or uninstall behavior |
| [Testing](./testing.md) | vitest with real child processes; cleanup | Writing tests, especially for liveness / hook |
| [i18n](./i18n.md) | self-built t() module, en ↔ zh symmetry, package nls placeholders | Adding i18n keys, package metadata localization, i18n-related tests |

Plus the project-wide thinking guides in [`guides/`](./guides/index.md) — those are not module-specific, read them whenever a new pattern appears.

---

## Operating Rules

- Specs are evidence-backed. Each rule points at a source file, a test, or a repeated pattern. Generic advice without a local hook is a sign the rule is wrong.
- The wire format (`HookPayload`) is a contract between `hook.sh` and `stateManager.ts`. Change one side without updating the other and the dashboard lies.
- The `_owner` tag in `~/.claude/settings.json` is how the extension identifies its own hooks so uninstall doesn't delete other tools'. Never remove or rename it without bumping the migration.
- Liveness is conservative by design: when in doubt, treat a process as alive. False positives (killing a live session) are worse than false negatives (a dead one lingering).
- 中文 OK in code comments and user-facing strings (`vscode.window.showWarningMessage` calls, status labels, README). Type names, identifiers, and test descriptions are English. See [[user_language]].

---

## Quick Sanity Commands

```bash
# Run unit tests (excludes integration/)
pnpm test

# Build the extension (tsup → dist/)
pnpm build

# Package a .vsix (requires login + LICENSE)
pnpm package

# Lint the spec for leftover template prose
grep -RE "To be filled|TODO: fill|placeholder" .trellis/spec
```

If a spec rule disagrees with code, **the code wins** — open a task to update the spec, but don't let the spec lag silently.