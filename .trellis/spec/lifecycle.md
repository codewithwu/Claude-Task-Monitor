# Lifecycle: activate, deactivate, installer, tree UI, notifier

> `src/extension.ts` is the only file that touches `vscode.ExtensionContext`. It wires the layers defined in `state.md` and `ingest.md` and reads user config.

---

## `activate()` flow — `src/extension.ts:27`

```
1. read config (4 keys)
2. mkdir sessions/ and sessions/.ended/
3. detectJq() → if missing, showErrorMessage (but continue)
4. write hook.sh to ~/.claude-task-monitor/hook.sh (0o755)
5. merge hooks into ~/.claude/settings.json with OWNER_TAG
6. archiveStaleFiles(SESSIONS_DIR, ENDED_DIR, staleHours)
7. construct SessionStore + SessionsWatcher + Notifier + dedupe fn
8. bootstrapExistingFiles(SESSIONS_DIR, watcher, store)
9. wire watcher.on('line', ...) → store.apply → Notifier on waiting transition
10. wire watcher.on('fileRemoved', ...) → synthetic SessionEnd
11. wire watcher.on('parseError', ...) → console.warn
12. await watcher.start()
13. create SessionTreeDataProvider + createTreeView
14. setInterval refresh tree (refreshMs)
15. setInterval pruneDeadSessions (livenessMs)
16. context.subscriptions.push(disposers)
```

Steps 3, 4, 5 each have their own try/catch and show an error toast on failure without aborting activation. A user with `jq` missing still gets the dashboard; a user without write access to `~/.claude/` gets an error toast but the extension stays alive.

Step 6 (`archiveStaleFiles`, `src/extension.ts:143-158`) moves `.jsonl` files older than `staleHours` into `.ended/`. Without it, leftover sessions from previous VS Code sessions would re-bootstrap every startup. Filename includes `Date.now() + randomUUID8` to match the liveness convention.

---

## `deactivate()` — `src/extension.ts:521`

Empty body. Resource release (watcher / leaderLock / context subscriptions) is handled automatically by VS Code disposing the registered subscriptions. The uninstall cleanup that used to live here has moved to `package.json scripts.vscode:uninstall → dist/uninstall.js` (see [Uninstall flow (09-05)](#uninstall-flow-vscodeuninstall--09-05)).

### Why no dialog?

`deactivate()` fires on **every** path that closes the extension host — Reload Window, closing the last VS Code window, disabling the extension, **and** uninstalling. Asking the user "卸载：是否同时移除已注入的 hooks 与 hook.sh?" on reload is pure noise with a real risk of misclicks. VS Code has no runtime API that fires *only* on uninstall, so the cleanup has to run via a different surface: the `vscode:uninstall` lifecycle script.

## Uninstall flow (`vscode:uninstall`, 09-05)

`package.json scripts.vscode:uninstall` is `"node ./dist/uninstall.js"`. VS Code calls it on the next launch after the user uninstalls the extension. The script:

1. Reads `~/.claude/settings.json`. If missing → done. If present and unchanged → no-op write (matches `installHookAssets` #9).
2. Runs `uninstallSettings(existing)` — strips every entry whose `_owner === OWNER_TAG`. If `hooks` becomes empty, the `hooks` key itself is deleted.
3. `fs.unlinkSync(~/.claude-task-monitor/hook.sh)` if it exists.
4. Any error → `console.warn` and exit 0. The uninstall already happened; noisy failures don't help the user.

`src/uninstall.ts` exports `runUninstall({ home })` as a pure function (home is injected for tests) and a thin `require.main === module` CLI wrapper. The function lives in its own tsup entry (`tsup.config.ts`) so it ships as `dist/uninstall.js` next to `dist/extension.js` — no `vscode` import, no Extension Host dependency.

### Why not keep the dialog?

The dialog had two failure modes:

1. **Reload Window / close window / disable extension** — none of these intend to uninstall, but the dialog still appears. Users click through reflexively and either keep hooks they no longer want or delete hooks they didn't intend to.
2. **Actual uninstall** — `deactivate()` is called *before* VS Code finishes uninstalling. The `void .then(...)` cleanup is racy and often dropped. The user reports "I uninstalled but my hooks are still there".

The `vscode:uninstall` hook (VS Code 1.21+, Feb 2018) is the official answer to both. Our `engines.vscode: ^1.86.0` covers it.

### Migration of the old i18n keys

`extension.uninstall.prompt` / `.remove` / `.keep` in `src/i18n/messages/{en,zh}.ts` are kept but unused after 09-05. Reserved for future use (e.g. a settings-page action). Removing them would break any user-pinned translation cache and gain nothing.

---

## `installer.ts` — `src/installer.ts`

Three responsibilities:

1. **`writeHookScript(sourcePath, targetPath)`** — copies `resources/hook.sh` from the extension bundle to `~/.claude-task-monitor/hook.sh`. Idempotent: if the target already matches the source content, just `chmodSync 0o755` (the bit may have been lost). Otherwise `writeFileSync` with `mode: 0o755`.

2. **`mergeSettings(existing, command)`** — reads existing `~/.claude/settings.json`, returns a new object with our hook entries added under `hooks.<event>`. Pre/PostToolUse entries get `matcher: '*'` (matches all tool names); the other five events don't. Each entry has `_owner: 'claude-task-monitor'` so `uninstallSettings` can find them later.

3. **`detectJq()`** — spawns `jq --version`, resolves to a boolean. Doesn't reject on missing; returns `false` so the caller can toast.

### `OWNER_TAG` — `src/installer.ts:17`

```ts
export const OWNER_TAG = 'claude-task-monitor'
```

This is the installer's safety net. `mergeSettings` only adds entries with this tag; `uninstallSettings` only removes entries with this tag. Without it, deactivate would delete hooks belonging to other extensions. **Never change this string** without bumping a migration that walks every existing settings.json and tags our entries retroactively.

---

## `treeDataProvider.ts` — `src/treeDataProvider.ts`

Adapter from `SessionStore` to `vscode.TreeDataProvider<SessionState>`. Three responsibilities:

1. **Refresh** — exposes `_onDidChange` event. Subscribes to `store.onChange` and to a manual `refresh()` (called by the 1s tick in `activate()` for the duration display).

2. **Per-item rendering** — `getTreeItem(s)` builds a `vscode.TreeItem` with:
   - **Label**: `path.basename(s.cwd) || s.cwd`. The tree is flat; cwd is the only grouping key.
   - **Icon**: `ThemeIcon(STATUS_ICON[s.status].id, new ThemeColor(STATUS_ICON[s.status].color))` — `circle-filled` in `charts.red`/`yellow`/`green`.
   - **Description**: `${STATUS_LABEL[s.status]} · ${humanizeDuration(elapsedSec)}` — status + "5m 12s" style elapsed.
   - **Tooltip**: a `MarkdownString` with cwd, status, prompt, current tool, session id.
   - **Command**: click → `vscode.openFolder(s.cwd, { forceNewWindow: false })`.
   - **contextValue**: `session-${status}` so future `when` clauses in `package.json` can filter.

3. **Children** — `getChildren()` returns `store.list()` (already sorted: `waiting < running < idle`, then `stateChangedAt` desc).

### Anti-patterns

- **Don't pull more data into `SessionState` for the tooltip.** Render-time formatting (`humanizeDuration`, `JSON.stringify(currentTool.input)`) belongs in the provider.
- **Don't bypass `store.onChange` and call `refresh()` from inside `apply()`.** Listeners fire synchronously inside `apply()`; calling `refresh()` from the watcher or anywhere else creates a double-fire race.
- **Don't add sub-nodes.** The tree is intentionally flat. Per-session tool-call history was considered and rejected — it turns the sidebar into a log viewer.
- **Don't mix controlled and untrusted data in `MarkdownString.appendMarkdown`.** The tooltip composes both:
  - Controlled (basename, statusLabel, sessionId, cwd) — safe to render as markdown (links, code blocks).
  - Untrusted (`lastUserPrompt`, `currentTool.name`, `currentTool.input`) — comes from JSONL hook payloads, content is attacker-controllable (a user prompt can be `[Click here](https://evil.example/p)`).

  `appendMarkdown` does not escape markdown syntax; an untrusted payload renders as a clickable link. **Untrusted fields must use `MarkdownString.appendText`** (literal characters, no markdown parsing). Regression test: `src/test/treeDataProvider.test.ts`.

---

## `notifier.ts` — `src/notifier.ts`

```ts
class Notifier {
  private lastNotifiedAt = new Map<string, number>()
  constructor(private readonly dedupeSeconds: number, private readonly fn: NotifyFn) {}
  notify(sessionId, toolName, cwd): void {
    const now = Date.now()
    if (now - (this.lastNotifiedAt.get(sessionId) ?? 0) < dedupeSeconds * 1000) return
    this.lastNotifiedAt.set(sessionId, now)
    this.fn(sessionId, toolName, cwd)
  }
}
```

Dedup is by `sessionId`, not by `toolName` — the user wants "one notification per session per N seconds", not "one notification per tool per N seconds". If a session goes through three tool permissions in 30 seconds, they get one toast.

The actual `showWarningMessage` callback is constructed inline in `extension.ts:65-73`:

```ts
(sessionId, toolName, cwd) => {
  const name = path.basename(cwd) || cwd
  const msg = `${name} 等待权限确认：${toolName}`
  void vscode.window.showWarningMessage(msg, '打开项目').then(action => {
    if (action === '打开项目') {
      void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(cwd), { forceNewWindow: false })
    }
  })
}
```

### Anti-patterns

- **Don't put `vscode.window.showWarningMessage` calls inside `Notifier`.** It would force the unit tests to mock VS Code; the current split (Notifier = pure dedup, callback = VS Code surface) lets `notifier.test.ts` run without VS Code at all.
- **Don't widen the dedup window beyond `notifyDedupeSeconds`** thinking "more is better". A long window means missing genuine re-prompts; the default 30s is already generous.

#### Leader election gating (08-31)

`Notifier` 回调首行检查 `leaderLock.isLeader()`；非 leader 窗口的 toast 路径直接 return。sidebar / status bar / badge 不受影响（走 `store.onChange`，与 toast 路径正交）。`src/extension.ts:122` 的回调结构保持不变，只是首行多一道闸门。详细协议见 `architecture.md#cross-window-coordination-via-lock-file-08-31` 和 `src/util/leaderLock.ts` 头注。

Gated by `claudeTaskMonitor.notifyLeaderElection`（默认 `true`）。关闭时闸门恒为 true，回退到「每窗口各弹一条」旧行为。

---

## Configuration — adding a new setting

To add `claudeTaskMonitor.foo` with default `42`:

1. Add to `package.json` `contributes.configuration.properties`:

   ```json
   "claudeTaskMonitor.foo": {
     "type": "number",
     "default": 42,
     "description": "..."
   }
   ```

2. Read in `activate()` (`src/extension.ts:28-32`) and pass to the consumer as a constructor arg:

   ```ts
   const foo = cfg.get<number>('foo', 42)
   const consumer = new SomeConsumer(foo)
   ```

3. Never re-read the config later with `cfg.get(...)` inside the consumer. Constructor injection keeps the consumer testable.

---

## Source map

| File | Role |
|------|------|
| `src/extension.ts` | `activate`/`deactivate`, config wiring, archive-on-startup, bootstrap |
| `src/installer.ts` | `writeHookScript`, `mergeSettings`, `uninstallSettings`, `detectJq`, `OWNER_TAG`, `HOOK_SCRIPT_REL`, `CLAUDE_SETTINGS_REL` |
| `src/uninstall.ts` | `runUninstall({ home })` + CLI entry — `dist/uninstall.js`, run by `vscode:uninstall` |
| `src/treeDataProvider.ts` | TreeDataProvider adapter (icon, tooltip, refresh) |
| `src/notifier.ts` | `Notifier.notify` with dedup map |
| `package.json` | settings, view registration, `activationEvents: ["onStartupFinished"]`, `scripts.vscode:uninstall` |