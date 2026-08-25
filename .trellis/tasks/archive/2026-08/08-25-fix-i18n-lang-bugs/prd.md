# Fix 5 i18n/lang bugs from code review

## Goal

Fix the 5 bugs surfaced by `/code-review @src/` on 2026-08-25, all clustered in the i18n/lang subsystem. Make the language toggle correctly handle the full state cycle (auto ↔ zh ↔ en), harden it against invalid runtime configuration, and make the validation/enumeration layer singular.

## Origin (pain point)

Code review of `src/` (forked agent, ~232s, 50 tool uses) found 5 defects that all touch the 08-23 ui-lang-toggle feature. They are mutually reinforcing — #4 (wrong comment) plants the mental model that allows #1 (override never clears), and #3 / #5 both reflect the same root cause: pref validation lives in a render-time defensive shim instead of at the data boundary. Fix them together so the next reader sees one consistent pipeline.

## Background — current state

- `src/util/langStore.ts` (08-23) holds the pref state machine. `currentLang()` calls `detectLang()` for `auto`, which reads the module-level `override` — set by previous non-auto transitions and never cleared. Spec at `.trellis/spec/i18n.md:20` requires the override to be cleared when pref is `auto`, but no code path does this.
- `src/extension.ts:327` — `toggleLanguage` catch block uses `(e as Error).message` and crashes on null/undefined rejections.
- `src/ui/langToggle.ts:29` — `safePref` hand-maintains a parallel enum of valid prefs that duplicates `PREF_ORDER` in `langStore.ts:21`. `LangStore.set/syncFromConfig` accept any string at runtime (compile-time cast only) so invalid prefs flow through to `setLangOverride()` and `detectLang()`.
- `src/util/langStore.ts:37` — comment on `currentLang()` describes behavior that contradicts the actual code (drives the wrong mental model).

## Functional Requirements

### FR1 — `LangStore.currentLang()` for `auto` reflects env, not stale override
- When pref is `auto`, return the language derived from `vscode.env.language` (env-only), never the module-level override set by previous non-auto transitions.

### FR2 — Override is cleared when pref is `auto` (spec compliance)
- Per `.trellis/spec/i18n.md:20`: "The override is written by `LangStore` on every cycle/set, and cleared (`undefined`) when pref is `auto`."
- The config-change listener in `extension.ts` must call `setLangOverride(undefined)` when the new pref is `auto`; otherwise call `setLangOverride(pref)`.

### FR3 — `LangStore` validates runtime pref at the data boundary
- `LangStore` constructor and `syncFromConfig()` must accept only `LangPref` values. Invalid runtime config (hand-edited `settings.json`, schema drift) falls back to `auto` with a `console.warn`.

### FR4 — `toggleLanguage` error toast is null-safe
- Catch block must not crash on null/undefined rejections. Use `e instanceof Error ? e.message : String(e)`.

### FR5 — Single source of truth for valid prefs
- `isLangPref()` exported from `langStore.ts` (defined as `(PREF_ORDER as readonly string[]).includes(x)`). Reused by:
  - `LangStore` constructor + `syncFromConfig()` (defensive fallback)
  - `LangToggle.render()` (replaces `safePref`)

### FR6 — Comment matches behavior
- `LangStore.currentLang()` JSDoc describes the actual resolution rule: `auto` → env (bypassing override); non-auto → that pref. Update header comment in `langStore.ts` and inline comment on `currentLang()`.

## Non-functional Requirements

### NFR1 — Tests must cover every changed behavior
- New tests:
  - `detectEnvLang()` bypasses override
  - `LangStore.currentLang()` for `auto` is unaffected by module-level override
  - `LangStore` constructor with invalid pref falls back to `auto`
  - `LangStore.syncFromConfig()` with invalid pref falls back to `auto`
  - `isLangPref` accepts/rejects correctly
- All existing tests (`pnpm test`) must pass unchanged.
- `pnpm typecheck` must pass.

### NFR2 — No new runtime dependencies
- Only touch files in `src/` already involved (`i18n/index.ts`, `util/langStore.ts`, `extension.ts`, `ui/langToggle.ts`) plus their existing tests. No new modules.

## Acceptance Criteria

- [ ] **AC1**: Cycling `auto → zh → en → auto` (e.g. via `langStore.set()` or 3× `cycle()`) leaves `langStore.currentLang()` returning the env-derived lang, not `'en'`. Verified by a new test in `src/test/langStore.test.ts`.
- [ ] **AC2**: After the cycle in AC1, the module-level override in `src/i18n/index.ts` is `undefined`. Verified by a new test that calls `detectLang()` and expects env-based result.
- [ ] **AC3**: `LangStore` constructor with `'fr'` (invalid) sets `this.current = 'auto'` and emits one `console.warn`. New test.
- [ ] **AC4**: `LangStore.syncFromConfig()` with mock returning `'fr'` sets `this.current = 'auto'`. New test.
- [ ] **AC5**: `isLangPref()` exported from `src/util/langStore.ts`; `LangToggle.render()` uses it (no local `safePref`). Diff shows deletion of `safePref`.
- [ ] **AC6**: `extension.ts:327` catch block uses `e instanceof Error ? e.message : String(e)`. Diff shows the change.
- [ ] **AC7**: `extension.ts` config listener for `claudeTaskMonitor.language` calls `setLangOverride(undefined)` when new pref is `auto`, else `setLangOverride(pref)`. Diff shows the conditional.
- [ ] **AC8**: `src/util/langStore.ts:37` comment accurately describes the new behavior (env-only for `auto`).
- [ ] **AC9**: `pnpm test` passes all suites (existing + new). `pnpm typecheck` passes.
- [ ] **AC10**: `setLangOverride(undefined)` reverts to env-based detection (existing test at `src/test/i18n.test.ts:75-81` still passes unchanged).

## Out of Scope

- Adding new languages (ja, ko, etc.) — already deferred per spec.
- Migrating to `vscode.l10n` — already deferred.
- Hardcoded Chinese strings elsewhere in `extension.ts:deactivate` (lines 412-413) and 5 other toasts (lines 82, 89, 159, 461, 468) — out-of-scope per `.trellis/spec/i18n.md:172-176`.
- Spec file `.trellis/spec/i18n.md` update — implementation is a faithful realization of the spec; no spec change needed unless we discover the spec itself is wrong.

## Risks

- **R1**: Test isolation — `override` is module-level state. New tests must call `setLangOverride(undefined)` in `afterEach`. Following the existing `i18n.test.ts` pattern.
- **R2**: The config listener in `extension.ts` is the only place that updates the override. If a future feature bypasses the listener (e.g. direct config write), the override won't be updated. Mitigation: the comment in `extension.ts` near the listener notes the listener as the single channel.