# Address 10 round-3 code-review findings on i18n/lang pipeline

## Goal

Code-review `@src/` on 2026-08-27 (forked agent, ~599s, 41 tool uses, with adversarial verification) surfaced 10 verified findings on the i18n/lang subsystem that survived the round-2 cleanup. They cluster into three buckets:

1. **Code correctness (3 findings)** — defects in the runtime path: `setLangOverride` activation bypasses `LangStore`'s defensive fallback; `formatToggleFailMessage` is too narrow to cover 8 other unsafe call sites; the helper itself mishandles `Error()` with empty message.
2. **Spec/doc drift (5 findings)** — comments, JSDoc, and cross-references that no longer match the code: `i18n.md:27` documents an obsolete pattern, `langStore.ts:60` JSDoc is ambiguous about who writes the override, `extension.ts:406` cites a broken anchor and wrong path, `i18n.test.ts:213` cites a line number that drifted, `i18n.test.ts:222` is missing trailing newline.
3. **Test smells (2 findings)** — `langToggle.test.ts` declares an unused `createSpy` and uses over-broad regex that defeats the assertion's intent.

Each finding stands alone but they share one theme: **the round-2 patch settled the i18n/lang runtime but left a thin layer of latent debt — code paths the helper didn't reach, comments that were stale at merge time, and tests that pass for the wrong reason.** Knock them out together so the next reviewer sees one pipeline with full coverage, stable cross-references, and tests that actually exercise the code path they claim to cover.

## Origin (pain point)

Round-3 findings (verbatim from the review agent, ranked by severity):

| # | File:Line | Class | One-line summary |
|---|---|---|---|
| 1 | `src/extension.ts:83` | correctness | `setLangOverride(langPref === 'auto' ? undefined : langPref)` writes the **raw** cfg value; when cfg is invalid, LangStore falls back to `'auto'` but `setLangOverride` still propagates the invalid string → `detectLang()` returns the bogus lang, `t()` falls through, status bar says "auto" while all text is English |
| 2 | `src/util/formatError.ts:17` | reuse | Helper is narrowly named `formatToggleFailMessage`; 8 other call sites (extension.ts:171/449/527/543/548, util/muted.ts:47/60, watcher.ts:93) still use unsafe `(e as Error).message ?? String(e)` — same bug class |
| 3 | `.trellis/spec/i18n.md:27` | spec drift | Spec line documents `setLangOverride(langStore.currentLang())`; listener at extension.ts:412 uses `setLangOverride(newPref === 'auto' ? undefined : newPref)` — patterns disagree |
| 4 | `src/util/langStore.ts:60` | doc drift | JSDoc "module override 在 set(zh/en) 时被 setLangOverride 写入" is ambiguous — reads as LangStore triggers the write, but the next line says "由 extension.ts 的 config listener 处理"; PRD marked JSDoc rewrite in-scope (FR5) but diff didn't touch it |
| 5 | `src/extension.ts:406` | doc drift | Comment cites `spec/i18n.md#manual-language-override` — path is missing `.trellis/` prefix AND the anchor slug is missing the `(08-23 ui-lang-toggle)` parenthetical that github-flavored markdown appends |
| 6 | `src/util/formatError.ts:18` | correctness | `e.message ?? String(e)` returns `''` for `new Error()` because default `Error.message` is `''` (not nullish); user sees "Failed to switch UI language: " with trailing colon and no message |
| 7 | `src/test/langToggle.test.ts:34` | test smell | `createSpy: MockInstance` declared and assigned but never referenced — would fail under `noUnusedLocals` |
| 8 | `src/test/langToggle.test.ts:59` | test smell | Regex `/English\|中文/` and `/Auto\|自动/` — but `vscode.env.language` is mocked to `'en'` for all tests; the `\|中文` and `\|自动` branches are unreachable, so the test passes even if Chinese rendering breaks |
| 9 | `src/test/i18n.test.ts:213` | doc drift | Comment "simulates extension.ts:80" but line 80 is `const langStore = new LangStore(langPref)`; the `setLangOverride` call is at line 83 |
| 10 | `src/test/i18n.test.ts:222` | style | File ends without trailing newline (`\ No newline at end of file`) |

## Background — current state

After round 2 (`08-26-fix-i18n-lang-bugs-round2`) the layout is:

```
src/extension.ts
  L79-83  activation:
    const langPref = cfg.get<LangPref>('language', 'auto')      ← raw cfg value
    const langStore = new LangStore(langPref)                    ← normalizes: 'fr' → 'auto' + warn
    setLangOverride(langPref === 'auto' ? undefined : langPref)  ← BUG: bypasses normalization
                                                                 writes 'fr' for invalid cfg
  L412   listener:
    setLangOverride(newPref === 'auto' ? undefined : newPref)    ← OK (newPref is langStore.get())
                                                                 which is normalized

src/util/formatError.ts
  L17    export function formatToggleFailMessage(e: unknown): string
  L18      return e instanceof Error ? (e.message ?? String(e)) : String(e)
                                                                 ↑ empty msg not caught
  Uses:   only extension.ts:330 (toggleLanguage catch)
  Should: also cover extension.ts:171/449/527/543/548, util/muted.ts:47/60, watcher.ts:93

src/util/langStore.ts
  L60    JSDoc: "module override 在 set(zh/en) 时被 setLangOverride 写入"
                                                                 ↑ ambiguous
  L60    "在 set(auto) 时必须清空 (由 extension.ts 的 config listener 处理)"
                                                                 ↑ correctly identifies listener
  →  JSDoc contradicts itself; rewrite to unambiguously say listener owns the write

src/extension.ts:406
  comment cites spec/i18n.md#manual-language-override
                    ↑ missing .trellis/ prefix AND wrong slug

.trellis/spec/i18n.md:27
  step 2: "setLangOverride(langStore.currentLang())"  ← stale; listener uses newPref pattern
  step 4: applies it as written

src/test/langToggle.test.ts
  L34   createSpy: MockInstance     ← declared + assigned, never used
  L59   expect(...).toMatch(/English|中文/)  ← '中文' branch unreachable when env='en'

src/test/i18n.test.ts
  L213  comment "extension.ts:80"   ← actual setLangOverride is at L83
  L222  no trailing newline
```

## Functional Requirements

### FR1 — Activation `setLangOverride` reads normalized pref, not raw cfg

- `src/extension.ts:83` switches from `langPref === 'auto'` (the raw cfg value) to `langStore.get() === 'auto'` (the post-normalization value).
- Concretely: when cfg is `'fr'` (or any non-`LangPref`), `LangStore` falls back to `'auto'` and the activation writes `setLangOverride(undefined)` — matching the listener's behavior at line 412.
- Add an inline comment explaining the asymmetry: "raw langPref may be invalid (defensive fallback in LangStore constructor); read through langStore.get() so override tracks normalized state."

### FR2 — Rename `formatToggleFailMessage` → `formatErrorMessage` and reuse everywhere

- Rename the helper in `src/util/formatError.ts`. Update JSDoc to reflect the broader scope (not toggle-specific).
- Replace `(e as Error).message ?? String(e)` and `(e as Error).message` patterns at:
  - `src/extension.ts:171` (watcher.start failure toast)
  - `src/extension.ts:449`
  - `src/extension.ts:527`
  - `src/extension.ts:543`
  - `src/extension.ts:548`
  - `src/util/muted.ts:47`
  - `src/util/muted.ts:60`
  - `src/watcher.ts:93`
- Each call site imports the helper from `./util/formatError.js` (or `../util/formatError.js`) and calls `formatErrorMessage(e)` in the `t()` template.
- Update existing test in `src/test/formatError.test.ts` to use the new name.

### FR3 — `formatErrorMessage` handles empty `Error.message` correctly

- `src/util/formatError.ts:18` changes `e.message ?? String(e)` to `e.message || String(e)` so `new Error()` (default message `''`) falls through to `String(e)` = `'Error'`.
- Update the test case for `new Error()` to expect `'Error'` (not `''`).
- Add a regression test: `formatErrorMessage(new Error()) === 'Error'`.

### FR4 — `i18n.md:27` matches listener pattern

- `.trellis/spec/i18n.md:27` (the step that reads `setLangOverride(langStore.currentLang())`) is rewritten to:
  > `setLangOverride(newPref === 'auto' ? undefined : newPref)` — propagate to `t()`. (For `auto` this is `undefined`, letting `t()` fall back to env; for `zh`/`en` this writes the concrete lang so `t()` overrides env.)
- The change is documentation-only; no runtime behavior changes.

### FR5 — `langStore.ts:60` JSDoc unambiguously identifies the listener

- The JSDoc on `currentLang()` is rewritten to one sentence:
  > `LangStore.currentLang()` resolves `'auto'` to env (via `detectEnvLang()`); it does **not** write the module override. The override is the sole responsibility of `extension.ts`'s `onDidChangeConfiguration` listener — `LangStore` stays decoupled from the i18n layer for unit-testability.
- The two-paragraph "为什么 'auto' 走 detectEnvLang 而非 detectLang" block becomes one paragraph because the "为什么" rationale is now subsumed by the rewritten opening sentence.

### FR6 — `extension.ts:406` cites a valid path + anchor

- The comment at `src/extension.ts:405-407` changes the spec reference from:
  > `spec/i18n.md#manual-language-override`
- to:
  > `.trellis/spec/i18n.md#manual-language-override-08-23-ui-lang-toggle`
- Both the path (`.trellis/spec/...`) and the anchor slug (full github-flavored markdown slug including the parenthetical date tag) are corrected.

### FR7 — `langToggle.test.ts` removes dead variable

- `src/test/langToggle.test.ts` deletes the `createSpy: MockInstance` declaration at line 34 and its assignment at line 45. If `vi.spyOn(vscode.window, 'createStatusBarItem')` is still needed for the mock to take effect, keep that call inline in `beforeEach` without the captured return value.

### FR8 — `langToggle.test.ts` tests Chinese rendering correctly

- The `\|中文` and `\|自动` regex alternatives in the zh-rendering tests (line 59 area) are dropped. Since the test mocks `vscode.env.language = 'en'`, `t()` returns English strings only; the regex alternatives are aspirational, not exercised.
- Add a separate test (or extend the `beforeEach`) that mocks `vscode.env.language = 'zh'` and asserts the Chinese strings appear in the tooltip. This makes the Chinese path actually covered instead of vacuously passing.

### FR9 — `i18n.test.ts:213` line cite corrected

- The comment "simulates extension.ts:80 with pref='auto'" updates to "simulates extension.ts:83 with pref='auto'" — line 83 is where `setLangOverride(langPref === 'auto' ? undefined : langPref)` lives after the FR1 fix lands.

### FR10 — `i18n.test.ts:222` has trailing newline

- Add a single `\n` at the end of `src/test/i18n.test.ts`. POSIX-friendly.

## Non-functional Requirements

### NFR1 — Tests cover every changed behavior

- New tests:
  - FR1: `src/test/i18n.test.ts` — add a test that activates with invalid pref (`'fr'`) and asserts `setLangOverride(undefined)` was written (observable via `detectLang()` returning env).
  - FR3: `src/test/formatError.test.ts` — adjust the `new Error()` case to expect `'Error'`; add an explicit assertion against `''`.
  - FR8: `src/test/langToggle.test.ts` — add a Chinese-rendering test with `vscode.env.language = 'zh'`.
- All existing tests must remain green.
- `pnpm typecheck` clean. `pnpm test` green.

### NFR2 — No new runtime dependencies

- Only edit existing files. Rename one helper. Add no new modules.

### NFR3 — Diff is surgical

- Net effect: ~30-50 LOC changed across 6 source/test files + 1 spec file. No incidental cleanup. No reformatting of unrelated code.

## Acceptance Criteria

- [ ] **AC1** (`extension.ts:83`): activation uses `langStore.get()` (normalized pref), not `langPref` (raw cfg). When cfg is invalid, `setLangOverride(undefined)` is written.
- [ ] **AC2** (`formatError.ts:17`): function renamed to `formatErrorMessage`. File's JSDoc reflects general-purpose error formatter (not toggle-specific).
- [ ] **AC3** (8 unsafe call sites): `extension.ts:171/449/527/543/548`, `util/muted.ts:47/60`, `watcher.ts:93` all call `formatErrorMessage(e)` instead of `(e as Error).message` / `(e as Error).message ?? String(e)`. `grep -nE '\(.*as Error\)\.message' src/` returns 0 hits.
- [ ] **AC4** (`formatError.ts:18`): uses `||` (not `??`) so empty `Error.message` falls through. `formatErrorMessage(new Error()) === 'Error'`.
- [ ] **AC5** (`i18n.md:27`): step 2 reads `setLangOverride(newPref === 'auto' ? undefined : newPref)`. `grep "langStore.currentLang" .trellis/spec/i18n.md` returns 0 hits.
- [ ] **AC6** (`langStore.ts:60`): JSDoc rewritten to one paragraph unambiguously attributing override writes to the listener.
- [ ] **AC7** (`extension.ts:406`): comment cites `.trellis/spec/i18n.md#manual-language-override-08-23-ui-lang-toggle` (correct path + correct anchor).
- [ ] **AC8** (`langToggle.test.ts:34`): `createSpy` declaration + assignment removed. `grep "createSpy" src/test/langToggle.test.ts` returns 0 hits.
- [ ] **AC9** (`langToggle.test.ts:59`): zh-rendering tests either drop unreachable regex alternatives OR (preferred) add a separate test that mocks env='zh' and asserts Chinese strings in the tooltip.
- [ ] **AC10** (`i18n.test.ts:213`): comment reads "extension.ts:83".
- [ ] **AC11** (`i18n.test.ts:222`): file ends with `\n`. `tail -c 1 src/test/i18n.test.ts | xxd` shows `0a`.
- [ ] **AC12** (regression): `pnpm test` passes. `pnpm typecheck` passes. No new skipped or `.todo` tests.

## Out of Scope

- Reverting any round-2 changes.
- Renaming `formatToggleFailMessage` to something other than `formatErrorMessage` (this task picks the name; if reviewer prefers `formatUnknown`, that's a follow-up).
- Restructuring `LangToggle` API.
- Moving override writing back into `LangStore.set()`.
- Adding new languages.
- Re-anchoring `i18n.md:27` (the spec section heading stays as-is; only the in-document line content changes).
- Removing the `(08-23 ui-lang-toggle)` parenthetical from the spec heading (would invalidate other cross-references).

## Risks

- **R1**: FR2 rename touches 8 call sites across 3 files. Any miss leaves an unsafe pattern. Mitigation: Step 9 has explicit `grep -nE '\(.*as Error\)\.message' src/` returning 0 hits as a gate.
- **R2**: FR3 changes test expectations (`''` → `'Error'`). If any downstream test relies on the old `''` behavior, it breaks. Mitigation: `pnpm test` green gate; explicit search for callers that expect empty.
- **R3**: FR8 changes test mock state (`vscode.env.language = 'en'` → possibly `'zh'`). Other tests in the file may share a `beforeEach` that overwrites env; verify isolation. Mitigation: per-test mock setup, not shared state.
- **R4**: FR6 anchor slug depends on github-flavored markdown rendering rules. If the heading text ever changes, the anchor breaks again. Mitigation: add a comment near the heading explaining the slug rule, so future editors know what the anchor depends on.