# Design — Address 10 round-3 code-review findings on i18n/lang pipeline

## Architecture overview

Round-2 cleaned up the runtime surface (helper extraction, dead-code removal, single-source env). Round-3 fills the gaps that round-2 didn't reach:

```
┌──────────────────────────────────────────────────────────────────┐
│ extension.ts (activation + listener)                              │
│   L83:  setLangOverride(langPref === 'auto' ? undefined : langPref)  ← FR1: read langStore.get()
│   L171/449/527/543/548: (e as Error).message ?? String(e)            ← FR2: formatErrorMessage
│   L330:  formatToggleFailMessage(e)                                  ← FR2: rename → formatErrorMessage
│   L406:  comment cites spec/i18n.md#manual-language-override         ← FR6: fix path + anchor slug
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ util/formatError.ts                                                │
│   L17:  export function formatToggleFailMessage                  ← FR2: rename → formatErrorMessage
│   L18:    return e instanceof Error ? (e.message ?? String(e))   ← FR3: ?? → ||
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ util/langStore.ts                                                  │
│   L60:  JSDoc "module override 在 set(zh/en) 时被 setLangOverride  ← FR5: unambiguous rewrite
│         写入" ambiguous — appears to claim LangStore writes it       (single paragraph)
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ util/muted.ts                                                      │
│   L47/60: (e as Error).message ?? String(e)                       ← FR2: formatErrorMessage
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ watcher.ts                                                         │
│   L93:  (e as Error).message ?? String(e)                         ← FR2: formatErrorMessage
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ test/i18n.test.ts                                                  │
│   L213: comment "extension.ts:80"                                  ← FR9: → 83
│   L222: no trailing newline                                         ← FR10: add \n
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ test/langToggle.test.ts                                             │
│   L34:  createSpy: MockInstance (unused)                          ← FR7: delete
│   L59:  regex /English|中文/ — Chinese branch unreachable          ← FR8: drop or mock env=zh
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ .trellis/spec/i18n.md                                              │
│   L27:  step 2 says setLangOverride(langStore.currentLang())      ← FR4: → newPref pattern
└──────────────────────────────────────────────────────────────────┘
```

The cross-cutting concerns are:
1. **Helper rename + reuse** (FR2) — touch 3 source files + 1 util + 1 test. Use `grep` to gate completion.
2. **Doc/spec consistency** (FR4-FR6, FR9) — five small text edits; each is grep-stable after the edit.
3. **Test quality** (FR7-FR8, FR10) — three small cleanups.

The runtime correctness fixes (FR1, FR3) are surgical: one line each, with a regression test.

## Change 1 — Activation reads normalized pref (FR1)

**File**: `src/extension.ts:79-83`

The current code:

```ts
const langPref = cfg.get<LangPref>('language', 'auto')
const langStore = new LangStore(langPref)
// 与 onDidChangeConfiguration 监听器 (L408) 对齐:auto 写 undefined,
// 让 t() 全局也回落到 env (spec spec/i18n.md#manual-language-override)
setLangOverride(langPref === 'auto' ? undefined : langPref)
```

The bug: when `cfg.get` returns an invalid string (e.g., user hand-edits settings.json to `'fr'`), `LangStore` constructor falls back to `'auto'` (with warn), but `setLangOverride` still receives `'fr'` because the activation reads `langPref` (raw) instead of `langStore.get()` (normalized).

After:

```ts
const langPref = cfg.get<LangPref>('language', 'auto')
const langStore = new LangStore(langPref)
// 与 onDidChangeConfiguration 监听器 (L412) 对齐:auto 写 undefined,
// 让 t() 全局也回落到 env (spec .trellis/spec/i18n.md#manual-language-override-08-23-ui-lang-toggle)
// 读 langStore.get() 而非 langPref:LangStore 构造器对非法 cfg 已回落到 'auto',
// 必须走规范化后的值,否则 setLangOverride 会写入 'fr' 之类的非法字符串。
const effective = langStore.get()
setLangOverride(effective === 'auto' ? undefined : effective)
```

This makes the activation symmetric with the listener (`newPref = langStore.get()` at L412) and routes through the same defensive fallback.

**Test strategy**: extend `src/test/i18n.test.ts` with a new test in the existing `activation pattern (08-26, FR3)` describe block (or a new sibling block):

```ts
describe('activation with invalid cfg (08-27, FR1)', () => {
  it('invalid cfg → setLangOverride(undefined) and detectLang returns env', () => {
    setLang('en')
    // Simulate LangStore normalization: invalid initial → 'auto' (warn suppressed)
    const langStore = new LangStore('fr' as unknown as LangPref)
    expect(langStore.get()).toBe('auto')
    // Activation pattern: setLangOverride(effective === 'auto' ? undefined : effective)
    setLangOverride(langStore.get() === 'auto' ? undefined : langStore.get())
    expect(detectLang()).toBe('en')
  })
})
```

This test fails on the current code (setLangOverride would be called with `'fr'`, detectLang returns... actually `detectLang()` reads `override ?? fromEnv()` where `override` is typed `Lang | undefined` so it would still fall through since `'fr'` is not `Lang`). Hmm — TypeScript prevents this at compile time but vitest doesn't enforce types at runtime. So the test must verify at the override level: `setLangOverride` stores `'fr'` directly, which is a runtime smell even if TypeScript allows it.

Better test: assert that `setLangOverride` is called with `undefined` (not `'fr'`):

```ts
it('activation with invalid cfg writes setLangOverride(undefined)', () => {
  const langStore = new LangStore('fr' as unknown as LangPref)
  // After FR1 fix, activation reads langStore.get() = 'auto' → writes undefined
  const effective = langStore.get()
  expect(effective === 'auto' ? undefined : effective).toBeUndefined()
})
```

This is testable because it asserts the value computed at the call site, not the i18n module's internal state.

## Change 2 — Rename helper + reuse everywhere (FR2)

**File**: `src/util/formatError.ts` + 3 source files

The rename is straightforward, but the broader point is: the helper exists, and 8 other call sites duplicate the unsafe pattern. The rename makes the API name neutral (not toggle-specific) so the broader reuse is justified.

### Rename

```ts
// src/util/formatError.ts

// 格式化 unknown 异常值为安全字符串,用于 toast 文案 / 用户可见的日志。
//
// 为什么需要 helper:
//   - workspace.getConfiguration().update() 在受限 profile / schema 校验失败时
//     可能 reject null/undefined 或非 Error 对象 (包装库行为),直接 .message 会
//     让错误处理本身抛 TypeError,用户反而看不到 toast。
//   - e instanceof Error 时:e.message 是 string | undefined (自定义 Error 子类可能
//     不赋值);空字符串/未赋值时 String(e) 兜底 (Error 默认 toString 是 "Error")。
//   - 非 Error 时:String(e) 把任意 unknown 安全转字符串 (null → "null",
//     undefined → "undefined", object → "[object Object]")。
//   - 关键:两条分支都走 String() 兜底,保证 t() 拿到非空字符串,避免
//     模板占位符 {0} 泄露给用户。

export function formatErrorMessage(e: unknown): string {
  return e instanceof Error ? (e.message || String(e)) : String(e)
}
```

Note: this change bundles FR2 (rename) and FR3 (empty message fallback) — both touch the same file at the same lines. Apply together.

### Reuse at 8 call sites

Each site currently looks like:

```ts
t('some.key', (e as Error).message ?? String(e))
// or
t('some.key', (e as Error).message)
```

Replace with:

```ts
import { formatErrorMessage } from '../util/formatError.js'  // or appropriate relative path

t('some.key', formatErrorMessage(e))
```

Sites:

| File | Line | Current pattern | Replacement |
|---|---|---|---|
| `src/extension.ts` | 171 | `(e as Error).message ?? String(e)` | `formatErrorMessage(e)` |
| `src/extension.ts` | 330 | `formatToggleFailMessage(e)` (already uses helper) | `formatErrorMessage(e)` (rename) |
| `src/extension.ts` | 449 | `(e as Error).message ?? String(e)` | `formatErrorMessage(e)` |
| `src/extension.ts` | 527 | `(e as Error).message ?? String(e)` | `formatErrorMessage(e)` |
| `src/extension.ts` | 543 | `(e as Error).message ?? String(e)` | `formatErrorMessage(e)` |
| `src/extension.ts` | 548 | `(e as Error).message ?? String(e)` | `formatErrorMessage(e)` |
| `src/util/muted.ts` | 47 | `(e as Error).message ?? String(e)` | `formatErrorMessage(e)` |
| `src/util/muted.ts` | 60 | `(e as Error).message ?? String(e)` | `formatErrorMessage(e)` |
| `src/watcher.ts` | 93 | `(e as Error).message ?? String(e)` | `formatErrorMessage(e)` |

**Note**: the FR2 description lists 8 unsafe sites, but the table has 9. Site #1 (extension.ts:330) was already using the helper from round 2; it now just gets renamed. So 8 unsafe patterns + 1 rename = 9 total edits. The grep gate (`(.*as Error\)\.message`) returns 0 hits after.

**Test strategy**: `src/test/formatError.test.ts` (existing from round 2) — rename references, add `new Error()` → `'Error'` expectation (FR3), add the explicit "never returns empty" assertion that was relaxed in round 2.

## Change 3 — Empty `Error.message` fallback (FR3)

This is bundled with FR2 — same file, same line. The change is `??` → `||` so empty string falls through.

**Rationale**: `new Error()` produces an `Error` whose `.message === ''`. The `??` operator treats `''` as truthy (non-nullish), so `e.message ?? String(e)` returns `''`. The user-facing toast shows "Failed to switch UI language: " (trailing colon + no message). The `||` operator treats `''` as falsy, falling through to `String(e)` which returns `'Error'` (the default `Error.toString()`).

**Test case update**:

```ts
// Before (round 2):
[new Error(), ''],                                  // WRONG: returns ''
// After (round 3):
[new Error(), 'Error'],                             // correct
```

Add explicit test:

```ts
it('returns "Error" for new Error() with default empty message', () => {
  expect(formatErrorMessage(new Error())).toBe('Error')
})
```

## Change 4 — `i18n.md:27` spec text (FR4)

**File**: `.trellis/spec/i18n.md`, line 27

Current:

```md
2. `setLangOverride(langStore.currentLang())` — propagate to `t()`.
```

Replacement:

```md
2. `setLangOverride(newPref === 'auto' ? undefined : newPref)` — propagate to `t()`. For `'auto'` this writes `undefined`, letting `t()` fall back to env (via `detectLang()`). For `zh`/`en` this writes the concrete lang so `t()` overrides env.
```

Why this matters: a spec/code drift on this line means a future reviewer applying "the spec" reintroduces the bug fixed in round 2 (concrete-lang override for `'auto'`). The spec must match the listener's actual pattern.

## Change 5 — `langStore.ts:60` JSDoc (FR5)

**File**: `src/util/langStore.ts:53-65`

Current (two paragraphs):

```ts
/**
 * 把 pref 解析成实际生效的 lang。
 * - pref='auto' → detectEnvLang() (env only,**不读** module override)
 * - pref='zh'/'en' → 直接返回
 *
 * 为什么 'auto' 走 detectEnvLang 而非 detectLang:
 * module override 在 set(zh/en) 时被 setLangOverride 写入,在 set(auto) 时
 * 必须清空 (由 extension.ts 的 config listener 处理)。走 detectEnvLang 让
 * LangStore 自己对 'auto' 的语义负责,不依赖外部清空动作。
 */
currentLang(): Lang {
  return this.current === 'auto' ? detectEnvLang() : this.current
}
```

Replacement (one paragraph, unambiguous):

```ts
/**
 * 把 pref 解析成实际生效的 lang。
 * - pref='auto' → detectEnvLang() (env only,**不读** module override)
 * - pref='zh'/'en' → 直接返回
 *
 * 注意:LangStore 不写 module override。override 由 extension.ts 的
 * onDidChangeConfiguration 监听器单一写入,LangStore 保持与 i18n 层解耦
 * (可单测,无需 mock vscode 状态)。'auto' 走 detectEnvLang 是 UI 跟随
 * env 的语义需要 —— LangToggle 只读 pref,UI 跟随由 detectEnvLang 解析,
 * 而 t() 全局则通过 setLangOverride(undefined) 回落 env (见 i18n spec)。
 */
currentLang(): Lang {
  return this.current === 'auto' ? detectEnvLang() : this.current
}
```

The new version:
- Opens with the contract (what `currentLang()` returns).
- Closes with the negative-space statement ("LangStore 不写 override") — removes the ambiguity.
- Cross-references the listener as the sole writer.
- Explains the design rationale (decoupling for testability).

## Change 6 — `extension.ts:406` anchor + path (FR6)

**File**: `src/extension.ts:405-407`

Current:

```ts
// 'auto' 必须显式清空 override (08-25):LangStore.currentLang() 已对 'auto' 走
// detectEnvLang 独立工作,但 spec (spec/i18n.md#manual-language-override) 要求
// setLangOverride(undefined) 在 pref=auto 时落地 —— 让 t() 全局也回落到 env。
// 否则 'auto' 仅 UI 跟随 env,新弹的 toast/notification 仍读陈旧 override。
```

Replacement:

```ts
// 'auto' 必须显式清空 override (08-25):LangStore.currentLang() 已对 'auto' 走
// detectEnvLang 独立工作,但 spec (.trellis/spec/i18n.md#manual-language-override-08-23-ui-lang-toggle) 要求
// setLangOverride(undefined) 在 pref=auto 时落地 —— 让 t() 全局也回落到 env。
// 否则 'auto' 仅 UI 跟随 env,新弹的 toast/notification 仍读陈旧 override。
```

Two corrections:
1. Path: `spec/i18n.md` → `.trellis/spec/i18n.md`
2. Anchor: `#manual-language-override` → `#manual-language-override-08-23-ui-lang-toggle` (full github-flavored markdown slug including the parenthetical date tag)

Why both: a future editor searching for the spec section will need both the correct path AND a working anchor to navigate to it.

## Change 7 — `langToggle.test.ts` dead variable (FR7)

**File**: `src/test/langToggle.test.ts:34,45`

Current:

```ts
describe('LangToggle (08-26)', () => {
  let item: ReturnType<typeof mockItem>
  let createSpy: MockInstance                  ← FR7: delete

  beforeEach(() => {
    item = mockItem()
    createSpy = vi
      .spyOn(vscode.window, 'createStatusBarItem')
      .mockReturnValue(item as unknown as vscode.StatusBarItem)
  })
  ...
```

Replacement:

```ts
describe('LangToggle (08-27)', () => {
  let item: ReturnType<typeof mockItem>

  beforeEach(() => {
    item = mockItem()
    vi
      .spyOn(vscode.window, 'createStatusBarItem')
      .mockReturnValue(item as unknown as vscode.StatusBarItem)
  })
  ...
```

The `vi.spyOn` call is still needed (it activates the mock); we just don't capture the return value. Note the `import type { MockInstance }` at the top is removed too if `createSpy` was the only consumer.

Also rename the describe block from `'LangToggle (08-26)'` to `'LangToggle (08-27)'` to mark the round-3 update. (Optional — round 2 vs round 3 naming is a minor preference; either is acceptable.)

## Change 8 — `langToggle.test.ts` Chinese rendering (FR8)

**File**: `src/test/langToggle.test.ts`, around line 59

Current (zh-rendering test):

```ts
it('renders zh: text = $(globe) 中, tooltip mentions next = en', () => {
  new LangToggle(() => 'zh')
  expect(item.text).toBe('$(globe) 中')
  expect(item.tooltip).toMatch(/English|中文/)    // unreachable |中文 branch
})
```

Problem: `vscode.env.language` is mocked to `'en'` for all tests in this file. `t()` reads from the English table. So the tooltip only contains English strings; `\|中文` is vacuously covered.

Two acceptable fixes (pick one based on test design intent):

**Option A — drop the over-broad regex**: assert specific English strings that should appear:

```ts
it('renders zh: text = $(globe) 中, tooltip mentions English state', () => {
  new LangToggle(() => 'zh')
  expect(item.text).toBe('$(globe) 中')
  expect(item.tooltip).toContain('English')  // nextPref(zh) = 'en' state name
})
```

**Option B — add a dedicated zh-rendering test** with env override:

```ts
it('renders zh tooltip with Chinese strings when env is zh', () => {
  setLang('zh-cn')  // mock helper from i18n test setup
  new LangToggle(() => 'zh')
  expect(item.text).toBe('$(globe) 中')
  expect(item.tooltip).toMatch(/中文|英文/)  // nextPref(zh) = 'en' → Chinese name for en
})
```

**Recommend Option B**: it actually exercises the Chinese rendering path. The existing `setLang` mock helper from `i18n.test.ts` is importable; if not, add a small inline mock in this file's `beforeEach`.

## Change 9 — `i18n.test.ts:213` line cite (FR9)

**File**: `src/test/i18n.test.ts:213`

Current:

```ts
it('setLangOverride(undefined) + env=en → detectLang returns en', () => {
  setLang('en')
  setLangOverride(undefined)              // simulates extension.ts:80 with pref='auto'
  expect(detectLang()).toBe('en')
})
```

Replacement:

```ts
it('setLangOverride(undefined) + env=en → detectLang returns en', () => {
  setLang('en')
  setLangOverride(undefined)              // simulates extension.ts:83 with pref='auto'
  expect(detectLang()).toBe('en')
})
```

After FR1, `extension.ts:83` is where the activation `setLangOverride` call lives. The comment now points to the correct line.

## Change 10 — `i18n.test.ts:222` trailing newline (FR10)

**File**: `src/test/i18n.test.ts`

Single character append: `\n` at the end of the file. POSIX-friendly.

**Validation**: `tail -c 1 src/test/i18n.test.ts | xxd` returns `00000000: 0a`.

## Test design summary

| File | New / edited tests | Purpose |
|---|---|---|
| `src/test/i18n.test.ts` | +1 test (FR1 invalid cfg) | Verifies `setLangOverride` receives normalized value |
| `src/test/formatError.test.ts` | rename + adjust 1 case + add 1 case (FR2, FR3) | New helper name; empty message fallback |
| `src/test/langToggle.test.ts` | delete 1 var (FR7) + add/fix 1 test (FR8) | Drop dead code; actually exercise Chinese path |

No other test files need updates.

## Compatibility

- No public API removal.
- `formatErrorMessage` is a rename — same signature, same semantics, slightly different name. If any third-party code imports `formatToggleFailMessage`, it breaks. Internal-only.
- `formatErrorMessage` semantics change: `new Error()` now returns `'Error'` instead of `''`. This is a bug fix, but if any caller depends on the old `''` behavior, it breaks. Internal-only; verify with `grep "formatToggleFailMessage" src/` (should return 0 hits after rename) and the test gate.
- Activation `setLangOverride` writes normalized value instead of raw. Round-2 already wrote normalized for `auto`; round-3 extends the same handling to invalid cfg.
- Spec/JSDoc/comment changes are documentation-only.

## Rollback

Single commit. `git revert <commit>` restores prior state. No data migration, no config schema change.

Files touched:
- `src/extension.ts` — L83 (FR1), L171/449/527/543/548/330 (FR2), L406 (FR6)
- `src/util/formatError.ts` — rename + empty-message fix (FR2, FR3)
- `src/util/langStore.ts` — JSDoc (FR5)
- `src/util/muted.ts` — L47, L60 (FR2)
- `src/watcher.ts` — L93 (FR2)
- `src/test/formatError.test.ts` — rename + tests (FR2, FR3)
- `src/test/langToggle.test.ts` — dead var, Chinese test (FR7, FR8)
- `src/test/i18n.test.ts` — FR1 test, FR9 comment, FR10 newline
- `.trellis/spec/i18n.md` — L27 (FR4)

9 files, ~30-50 LOC.