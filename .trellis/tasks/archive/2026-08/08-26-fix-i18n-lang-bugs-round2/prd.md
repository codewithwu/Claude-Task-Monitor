# Address 7 code-review findings on i18n/lang pipeline (round 2)

## Goal

Round-2 cleanup of the i18n/lang subsystem after `08-25-fix-i18n-lang-bugs` and the v0.3.2 release. `/code-review @src/` on 2026-08-26 (forked agent, ~496s, 34 tool uses) verified 7 follow-up findings clustered in the same code. The 08-25 fix shipped with good tests but missed the seams those tests don't cover: the error-handler regression in the toast path, the env-resolution duplication that the new `detectEnvLang()` introduced, the activation-vs-listener override asymmetry, the dead defensive branch in `LangToggle.render()`, the spec/code mismatch on who owns the override write, the brittle `:20` spec line cite, and the missing `LangToggle` test file.

Each finding stands alone but they cluster around one theme: **the 08-25 patch settled the runtime bug surface but left three classes of latent debt — duplicated env logic, dead defensive code, and comments that will rot faster than the code.** Knock them out together so the next reader sees one consistent pipeline with single-source env resolution, no dead branches, and stable spec/code cross-references.

## Origin (pain point)

Round-2 findings (verbatim from the review agent, grouped by file):

| # | File:Line | Class | One-line summary |
|---|---|---|---|
| 1 | `src/extension.ts:330` | bug | Error fallback regressed: loses `String()` fallback when `Error.message` is null/undefined → user sees literal `{0}` in toast |
| 2 | `src/i18n/index.ts:53` | duplication | `detectEnvLang()` duplicates env-resolution branch of `detectLang()` verbatim — old comment in `langStore.ts` explicitly forbade this |
| 3 | `src/extension.ts:80` | inconsistency | Activation writes `setLangOverride(langStore.currentLang())`; listener writes `undefined` for auto — same outcome, inconsistent state |
| 4 | `src/ui/langToggle.ts:46` | dead code | `if (!isLangPref(raw))` branch is unreachable after 08-25 hardening; maintenance surface nobody exercises |
| 5 | `src/util/langStore.ts:60` | spec/code mismatch | Spec says "override written by LangStore"; code comment says "written by extension.ts config listener" — these disagree |
| 6 | `src/extension.ts:404` | brittle cite | Hard-codes `(.trellis/spec/i18n.md:20)` — any reorg of that spec file silently invalidates the justification |
| 7 | `src/ui/langToggle.ts:1` | test gap | No `langToggle.test.ts` — only indirect coverage via i18n key symmetry |

## Background — current state

After 08-25 the layout is:

```
┌──────────────────────────────────────────────────────────────────┐
│ i18n: src/i18n/index.ts                                          │
│      - detectLang()  : override ?? env.startsWith('zh')          │
│      - detectEnvLang(): env.startsWith('zh')   [NEW in 08-25]    │
│      - ↑ these two diverge at line 44 vs 54, share 1 line of     │
│        logic but no shared helper                                │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ Store: src/util/langStore.ts                                     │
│      - PREF_ORDER + isLangPref (single source for valid prefs)   │
│      - constructor + syncFromConfig both validate via isLangPref │
│      - currentLang() = pref='auto' ? detectEnvLang() : pref     │
│      - JSDoc on currentLang says override is cleared by          │
│        "extension.ts 的 config listener" — but spec i18n.md:20   │
│        says it's cleared by LangStore                            │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ UI: src/ui/langToggle.ts                                         │
│      - render(): isLangPref(raw) guard → '?' + tooltip          │
│        (unreachable per finding #4)                              │
│      - no dedicated test file                                     │
└──────────────────────────────────────────────────────────────────┘

extension.ts:
  - L80 activation: setLangOverride(langStore.currentLang())
                                       ↑ concrete lang for auto, not undefined
  - L330 toggleLanguage catch: e instanceof Error ? e.message : String(e)
                                       ↑ no ?? String(e) fallback
  - L404 spec cite: hardcoded line :20
  - L408-409 listener: setLangOverride(newPref === 'auto' ? undefined : newPref)
                                       ↑ writes undefined for auto
```

## Functional Requirements

### FR1 — `extension.ts:330` toast survives `Error.message === null/undefined` and non-`Error` rejects
- The catch block must apply the `String()` fallback **on both branches** of the `instanceof Error` check, so a wrapped library rejecting with `{ message: undefined }` or `null` produces a usable error string rather than leaking the `{0}` template placeholder.
- Acceptance form: `e instanceof Error ? (e.message ?? String(e)) : String(e)`.

### FR2 — Single source of truth for env-language resolution
- `i18n/index.ts` extracts a private helper `fromEnv(): Lang` (or inlines into one of the two, with the other delegating). `detectLang` and `detectEnvLang` both go through it. Editing the resolution rule (e.g. accept `cn`, `zh-Hans-*`) must touch exactly one line.
- No new exported symbol; the helper is file-private.

### FR3 — Activation writes override consistently with listener
- `extension.ts:80` activation path adopts the same pattern as the listener: `setLangOverride(langPref === 'auto' ? undefined : langPref)`.
- Internal `override` for pref=`auto` is always `undefined` after both activation and config changes. `detectLang()` semantics (override-priority) are preserved.

### FR4 — Delete unreachable defensive branch in `LangToggle.render()`
- The `if (!isLangPref(raw))` branch (lines 46-54 of `ui/langToggle.ts`) is removed. `getPref: () => LangPref` is the type contract; both producers (`LangStore.get`, `LangStore.currentLang` indirectly via `langStore.get`) are already filtered by `isLangPref` in `LangStore` constructor + `syncFromConfig`.
- The `lang.toggle.invalid` i18n key is no longer referenced and may be removed from `messages/{en,zh}.ts` along with the symmetry test that exercises it (if applicable — verify before deletion).

### FR5 — Spec/code agree on who writes the override
- `.trellis/spec/i18n.md` is updated so the "Manual language override" section accurately describes the architecture: override is written by `extension.ts`'s config-change listener (the single channel). `LangStore` remains decoupled from the i18n layer (this matches the 08-25 design choice and the existing `langStore.ts:8-9` rationale: "事件由 onDidChangeConfiguration 单一通道驱动,避免双触发").
- The misleading line in `langStore.ts:60` JSDoc is rewritten to point at the listener as the single writer.

### FR6 — Replace brittle `:20` line cite with stable reference
- `extension.ts:404` comment changes from `(.trellis/spec/i18n.md:20)` to either:
  - (a) the section heading anchor: `(spec/i18n.md#manual-language-override)`, or
  - (b) a direct quote of the spec sentence.
- Recommendation: (a) — anchor-based reference is grep-stable and survives section renames if the heading is preserved.

### FR7 — Dedicated `LangToggle` test file
- New file `src/test/langToggle.test.ts` covers:
  - Render with each valid pref (`auto` / `zh` / `en`) → `item.text` contains the matching `LABELS[raw]` symbol.
  - Tooltip composes the i18n `state.<raw>` + `state.<next>` names.
  - Render after pref change reflects the new state (subscription-style: getter is invoked each call, no internal caching).
  - `dispose()` disposes the underlying `StatusBarItem`.
- The new tests use the `vscode` mock from `@vscode/test-utils` (same pattern as `statusBar.test.ts`).

## Non-functional Requirements

### NFR1 — Tests cover every changed behavior
- New tests added for:
  - FR1: synthetic Error with `message = null` and `message = undefined` produce non-`{0}` toast (extension.ts:330 — but the catch block has no extracted function; test via spec is awkward. See Implementation §"FR1 test strategy" for the chosen approach.)
  - FR2: changes to env-language resolution are tested via existing i18n tests (they already cover `detectLang` and `detectEnvLang`; after refactor both should still pass with the same expectations).
  - FR3: synthetic test that activation path sets `setLangOverride(undefined)` when pref is `auto`. Existing `i18n.test.ts` setup already covers `detectLang()`-with-override; add a test that calls `setLangOverride(undefined)` and asserts `detectLang()` returns env.
  - FR4: removed branch — no direct test; verified by `pnpm test` remaining green and the symmetry test staying green after `lang.toggle.invalid` key removal (if removed).
  - FR5: spec updated; covered by `pnpm validate` (no test).
  - FR6: comment-only change.
  - FR7: new tests in `langToggle.test.ts`.
- `pnpm test` passes (existing + new). `pnpm typecheck` clean.

### NFR2 — No new runtime dependencies
- Only edit existing files in `src/` + create one new test file. No new modules. No new packages.

### NFR3 — Diff is surgical
- Net effect: ~30 LOC changed across 4 source files + 1 spec file + 1 new test file. No incidental cleanup. No reformatting of unrelated code.

## Acceptance Criteria

- [ ] **AC1** (`extension.ts:330`): catch block uses `e instanceof Error ? (e.message ?? String(e)) : String(e)`. Diff shows the change.
- [ ] **AC2** (`i18n/index.ts`): env-resolution logic exists in exactly one place (`fromEnv()` private helper). `detectLang` and `detectEnvLang` both call it. Grep `startsWith('zh')` returns exactly 1 hit in `src/i18n/index.ts`.
- [ ] **AC3** (`extension.ts:80`): activation writes `setLangOverride(langPref === 'auto' ? undefined : langPref)` (or equivalent using `langStore.get()`). No concrete-lang override for `auto` after activation.
- [ ] **AC4** (`ui/langToggle.ts`): `if (!isLangPref(raw))` branch is deleted. `render()` falls through to the normal `LABELS[raw]` / tooltip path.
- [ ] **AC5** (`util/langStore.ts:53-62` JSDoc): comment accurately identifies `extension.ts`'s config listener as the single channel that writes `setLangOverride`. No claim that LangStore itself writes the override.
- [ ] **AC6** (`.trellis/spec/i18n.md` "Manual language override" section): text accurately states the architecture — override written by `extension.ts`'s `onDidChangeConfiguration` listener. The phrase "written by LangStore" is gone.
- [ ] **AC7** (`extension.ts:404` area): spec reference uses section anchor (`#manual-language-override`) or quoted text, not a raw line number.
- [ ] **AC8** (`src/test/langToggle.test.ts`): new file exists. Covers: render with each pref, tooltip composition, render-after-change, dispose. ≥ 4 test cases.
- [ ] **AC9** (regression): `pnpm test` passes all suites (existing + new). `pnpm typecheck` passes. No skipped or `.todo` tests.
- [ ] **AC10** (i18n key cleanup, conditional): if `lang.toggle.invalid` key is removed (FR4), it is removed from BOTH `messages/en.ts` and `messages/zh.ts`. Symmetry test `src/test/i18n.test.ts` (the `Object.keys(en).sort() === Object.keys(zh).sort()` check) still passes.

## Out of Scope

- Reverting any 08-25 changes (the override lifecycle, `detectEnvLang`, `isLangPref`, defensive validation, null-safe catch — all stay).
- Adding new languages or `vscode.l10n` migration (deferred per spec).
- Hardcoded Chinese strings elsewhere in `extension.ts:deactivate` (lines 412-413) and 5 other toasts — out-of-scope per `.trellis/spec/i18n.md:172-176`.
- Restructuring `LangToggle` to take a full `LangStore` instance instead of a getter (current narrow API is intentional — `render()` only reads pref).
- Moving override writing from listener back into `LangStore` (would couple LangStore to i18n layer, contradicting the 08-25 design choice in `langStore.ts:8-9`).

## Risks

- **R1**: FR4 deletes the defensive branch and FR10 may delete the `lang.toggle.invalid` key. If any other code path (now or in the future) surfaces a non-`LangPref` value, the render path will fall through to `LABELS[undefined]` which TypeScript catches but the runtime yields `undefined`. Mitigation: `LABELS` becomes `Record<LangPref, string>` (already typed) — and the constructor of `LangToggle` does a single `isLangPref(getPref())` check at construction time as a hard guarantee, throwing on bad input. This shifts the check from "every render" (overhead) to "once at construction" (sufficient, since the getter is expected to be stable).
- **R2**: Spec edit (FR5) is the kind of change that breaks if downstream tooling parses the spec — confirm with `pnpm validate` after edit.
- **R3**: Removing the `lang.toggle.invalid` key (FR10 conditional) might leave dangling translations if the symmetry test is bypassed. Mitigation: run symmetry test explicitly after the removal.
