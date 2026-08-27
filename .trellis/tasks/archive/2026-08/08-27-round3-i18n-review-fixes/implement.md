# Implement — Address 10 round-3 code-review findings on i18n/lang pipeline

## Execution order

The 10 fixes are largely independent. Two natural orderings matter:
- FR2 (helper rename + reuse) and FR3 (empty-message fix) touch the same file (`util/formatError.ts`) and same line. Apply together as one edit.
- FR1 (activation normalization) and FR4-6 (spec/comment refs) all reference extension.ts around lines 79-83 and 405-407. Doing these in sequence avoids confusion between "before" and "after" states.

Apply in this order:

1. **Step 1** — `src/util/formatError.ts` rename + empty-message fix (FR2 + FR3, one file)
2. **Step 2** — Replace unsafe patterns at 8 call sites (FR2, multiple files)
3. **Step 3** — `src/extension.ts:83` activation normalization (FR1)
4. **Step 4** — `src/extension.ts:406` anchor + path fix (FR6)
5. **Step 5** — `src/util/langStore.ts:60` JSDoc rewrite (FR5)
6. **Step 6** — `.trellis/spec/i18n.md:27` text update (FR4)
7. **Step 7** — `src/test/i18n.test.ts` — FR1 test + FR9 comment + FR10 newline
8. **Step 8** — `src/test/langToggle.test.ts` — FR7 dead var + FR8 Chinese test
9. **Step 9** — `src/test/formatError.test.ts` — rename references + FR3 test expectation
10. **Step 10** — Validation gates
11. **Step 11** — Re-run `/code-review @src/` to verify all 10 findings closed
12. **Step 12** — Commit

## Step-by-step

### Step 1 — `src/util/formatError.ts` (FR2 + FR3)

Rename function + change `??` → `||`. Single-file edit.

Before (current):

```ts
// 格式化 toggleLanguage 命令的 reject 值,用于 toast 文案。
//
// 为什么需要 helper:
//   - workspace.getConfiguration().update() 在受限 profile / schema 校验失败时
//     可能 reject null/undefined 或非 Error 对象 (包装库行为),直接 .message 会
//     让错误处理本身抛 TypeError,用户反而看不到 toast。
//   - e instanceof Error 时:e.message 是 string | undefined (自定义 Error 子类可能
//     不赋值);null/undefined 时 String(e) 兜底 (Error 默认 toString 是 "Error")。
//   - 非 Error 时:String(e) 把任意 unknown 安全转字符串 (null → "null",
//     undefined → "undefined", object → "[object Object]")。
//   - 关键:两条分支都走 String() 兜底,保证 t() 拿到非 undefined,避免
//     模板占位符 {0} 泄露给用户。
//
// 单独抽到 util 模块而不是内联在 extension.ts,便于在 langToggle.test.ts 等
// 测试文件里直接 import 覆盖(extension.ts 顶层副作用太多,不适合做单测入口)。

export function formatToggleFailMessage(e: unknown): string {
  return e instanceof Error ? (e.message ?? String(e)) : String(e)
}
```

After:

```ts
// 格式化 unknown 异常值为安全字符串,用于 toast 文案 / 用户可见的日志。
//
// 为什么需要 helper (08-27 扩到全 codebase):
//   - workspace.getConfiguration().update() / watcher.onDidChange / muted push 等
//     在受限 profile / schema 校验失败 / 文件 IO 异常时可能 reject null/undefined
//     或非 Error 对象 (包装库行为),直接 .message 会让错误处理本身抛 TypeError,
//     用户反而看不到 toast。
//   - e instanceof Error 时:e.message 是 string | undefined (自定义 Error 子类
//     可能不赋值);空字符串/未赋值时 String(e) 兜底 (Error 默认 toString 是
//     "Error")。
//   - 非 Error 时:String(e) 把任意 unknown 安全转字符串 (null → "null",
//     undefined → "undefined", object → "[object Object]")。
//   - 关键:两条分支都走 String() 兜底,保证 t() 拿到非空字符串,避免
//     模板占位符 {0} 或 ": " 之类的空 message 泄露给用户。
//
// 单独抽到 util 模块而不是内联在 extension.ts,便于在 langToggle.test.ts 等
// 测试文件里直接 import 覆盖(extension.ts 顶层副作用太多,不适合做单测入口)。
// extension.ts / muted.ts / watcher.ts 的所有 catch 块都走这里。

export function formatErrorMessage(e: unknown): string {
  return e instanceof Error ? (e.message || String(e)) : String(e)
}
```

Two changes:
- Function renamed: `formatToggleFailMessage` → `formatErrorMessage`
- `e.message ?? String(e)` → `e.message || String(e)` (empty string now falls through)

**Validation**: `pnpm typecheck` (will fail until Step 2 updates callers). Continue to Step 2.

### Step 2 — Replace unsafe patterns at 8 sites (FR2)

Replace `(e as Error).message ?? String(e)` and `(e as Error).message` with `formatErrorMessage(e)`. Also update the existing `formatToggleFailMessage` reference.

| File | Line | Current | After |
|---|---|---|---|
| `src/extension.ts` | 171 | `t('...', (e as Error).message ?? String(e))` | `t('...', formatErrorMessage(e))` |
| `src/extension.ts` | 330 | `t('lang.toggle.fail', formatToggleFailMessage(e))` | `t('lang.toggle.fail', formatErrorMessage(e))` |
| `src/extension.ts` | 449 | `t('...', (e as Error).message ?? String(e))` | `t('...', formatErrorMessage(e))` |
| `src/extension.ts` | 527 | `t('...', (e as Error).message ?? String(e))` | `t('...', formatErrorMessage(e))` |
| `src/extension.ts` | 543 | `t('...', (e as Error).message ?? String(e))` | `t('...', formatErrorMessage(e))` |
| `src/extension.ts` | 548 | `t('...', (e as Error).message ?? String(e))` | `t('...', formatErrorMessage(e))` |
| `src/util/muted.ts` | 47 | `... (e as Error).message ?? String(e) ...` | `... formatErrorMessage(e) ...` |
| `src/util/muted.ts` | 60 | `... (e as Error).message ?? String(e) ...` | `... formatErrorMessage(e) ...` |
| `src/watcher.ts` | 93 | `... (e as Error).message ?? String(e) ...` | `... formatErrorMessage(e) ...` |

For each file, also add the import:

```ts
// src/extension.ts (top, near other util imports)
import { formatErrorMessage } from './util/formatError.js'

// src/util/muted.ts
import { formatErrorMessage } from './formatError.js'

// src/watcher.ts
import { formatErrorMessage } from './util/formatError.js'
```

Verify each file's existing import block to find the right insertion point.

**Validation**:
- `pnpm typecheck` (no more dangling references)
- `grep -nE '\(.*as Error\)\.message' src/` returns 0 hits
- `grep -nE 'formatToggleFailMessage' src/` returns 0 hits

### Step 3 — `src/extension.ts:83` activation (FR1)

Replace activation line to read normalized pref:

Before:

```ts
const langPref = cfg.get<LangPref>('language', 'auto')
const langStore = new LangStore(langPref)
// 与 onDidChangeConfiguration 监听器 (L408) 对齐:auto 写 undefined,
// 让 t() 全局也回落到 env (spec spec/i18n.md#manual-language-override)
setLangOverride(langPref === 'auto' ? undefined : langPref)
```

After (also fixes the path/anchor in the comment, since Step 4 will too — do them together to avoid double-editing the comment block):

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

Three changes bundled:
1. Read `langStore.get()` (normalized) instead of `langPref` (raw).
2. Update L408 → L412 (line drift from round-2 changes).
3. Pre-fix the broken comment (combine with Step 4 to avoid double-edit).

**Validation**: `pnpm typecheck`. The L412 reference is accurate after this edit (line 412 is the listener's `setLangOverride` call).

### Step 4 — `src/extension.ts:406` anchor + path (FR6)

If Step 3 already updated the comment at L81-83, this step is partially done. Verify L406-407 separately.

Before:

```ts
// 'auto' 必须显式清空 override (08-25):LangStore.currentLang() 已对 'auto' 走
// detectEnvLang 独立工作,但 spec (spec/i18n.md#manual-language-override) 要求
// setLangOverride(undefined) 在 pref=auto 时落地 —— 让 t() 全局也回落到 env。
```

After:

```ts
// 'auto' 必须显式清空 override (08-25):LangStore.currentLang() 已对 'auto' 走
// detectEnvLang 独立工作,但 spec (.trellis/spec/i18n.md#manual-language-override-08-23-ui-lang-toggle) 要求
// setLangOverride(undefined) 在 pref=auto 时落地 —— 让 t() 全局也回落到 env。
```

Two corrections:
1. Path: `spec/i18n.md` → `.trellis/spec/i18n.md`
2. Anchor slug: `#manual-language-override` → `#manual-language-override-08-23-ui-lang-toggle`

**Validation**: `grep "spec/i18n.md#manual-language-override" src/` returns 0 hits. `grep ".trellis/spec/i18n.md#manual-language-override-08-23-ui-lang-toggle" src/` returns ≥ 1 hit (both comment sites).

### Step 5 — `src/util/langStore.ts:60` JSDoc (FR5)

Replace the two-paragraph JSDoc with a single unambiguous paragraph.

Before:

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

After:

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

The function signature/body is unchanged; only the JSDoc text is rewritten.

**Validation**: `pnpm typecheck`. `grep "在 set(zh/en) 时" src/util/langStore.ts` returns 0 hits.

### Step 6 — `.trellis/spec/i18n.md:27` (FR4)

Before:

```md
2. `setLangOverride(langStore.currentLang())` — propagate to `t()`.
```

After:

```md
2. `setLangOverride(newPref === 'auto' ? undefined : newPref)` — propagate to `t()`. For `'auto'` this writes `undefined`, letting `t()` fall back to env (via `detectLang()`). For `zh`/`en` this writes the concrete lang so `t()` overrides env.
```

**Validation**: `grep "setLangOverride(langStore.currentLang())" .trellis/spec/i18n.md` returns 0 hits. (Note: also delete this obsolete pattern from anywhere else it might linger in i18n.md.)

### Step 7 — `src/test/i18n.test.ts` (FR1 test + FR9 comment + FR10 newline)

Three small edits in one file.

**(a) FR9 — fix line cite at L213:**

Before:

```ts
setLangOverride(undefined)              // simulates extension.ts:80 with pref='auto'
```

After:

```ts
setLangOverride(undefined)              // simulates extension.ts:83 with pref='auto'
```

**(b) FR1 — add new test for invalid cfg:**

Inside the existing `describe('activation pattern (08-26, FR3)', ...)` block, add:

```ts
it('activation with invalid cfg normalizes through langStore.get() (08-27, FR1)', () => {
  setLang('en')
  // LangStore 构造器对非法 pref 回落 'auto' (warn suppressed)
  const langStore = new LangStore('fr' as unknown as LangPref)
  expect(langStore.get()).toBe('auto')
  // Activation 模式 (FR1 后):读 langStore.get() 而非 raw langPref
  const effective = langStore.get()
  setLangOverride(effective === 'auto' ? undefined : effective)
  // setLangOverride 写入 undefined → detectLang 回落 env
  expect(detectLang()).toBe('en')
})
```

**(c) FR10 — add trailing newline:**

Append `\n` if not already present.

**Validation**: `pnpm test src/test/i18n.test.ts` — green. `tail -c 1 src/test/i18n.test.ts | xxd` shows `0a`.

### Step 8 — `src/test/langToggle.test.ts` (FR7 + FR8)

**(a) FR7 — delete dead variable:**

Before:

```ts
import { describe, it, expect, beforeEach, vi, type MockInstance } from 'vitest'
import * as vscode from 'vscode'
import { LangToggle } from '../ui/langToggle.js'
import { type LangPref } from '../util/langStore.js'

// Mock StatusBarItem
const mockItem = () => ({
  text: '',
  tooltip: undefined as string | undefined,
  command: undefined as string | undefined,
  name: undefined as string | undefined,
  alignment: 0,
  priority: 0,
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn(),
})

describe('LangToggle (08-26)', () => {
  let item: ReturnType<typeof mockItem>
  let createSpy: MockInstance              ← FR7: delete

  beforeEach(() => {
    item = mockItem()
    createSpy = vi                         ← FR7: delete
      .spyOn(vscode.window, 'createStatusBarItem')
      .mockReturnValue(item as unknown as vscode.StatusBarItem)
  })
  ...
```

After:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as vscode from 'vscode'
import { LangToggle } from '../ui/langToggle.js'
import { type LangPref } from '../util/langStore.js'

// Mock StatusBarItem
const mockItem = () => ({
  text: '',
  tooltip: undefined as string | undefined,
  command: undefined as string | undefined,
  name: undefined as string | undefined,
  alignment: 0,
  priority: 0,
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn(),
})

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

Three sub-changes: remove `MockInstance` from the import, remove `let createSpy` declaration, remove `createSpy =` from the `beforeEach` spy call.

**(b) FR8 — add Chinese rendering test:**

Find the existing zh-rendering test:

```ts
it('renders zh: text = $(globe) 中, tooltip mentions next = en', () => {
  new LangToggle(() => 'zh')
  expect(item.text).toBe('$(globe) 中')
  // nextPref(zh) = 'en' → tooltip should mention English state
  expect(item.tooltip).toMatch(/English|英文/)
})
```

Two changes:
1. Drop `\|中文` / `\|英文` from the over-broad regex (English-only test stays English-only).
2. Add a dedicated Chinese rendering test that mocks `vscode.env.language = 'zh'`:

```ts
it('renders zh tooltip with Chinese strings when env=zh (08-27, FR8)', () => {
  // mock vscode.env.language for this test only
  const originalLang = vscode.env.language
  ;(vscode.env as { language: string }).language = 'zh-cn'
  try {
    new LangToggle(() => 'zh')
    expect(item.text).toBe('$(globe) 中')
    // nextPref(zh) = 'en' → tooltip should mention Chinese state for 'en'
    expect(item.tooltip).toMatch(/中文|英文/)
  } finally {
    ;(vscode.env as { language: string }).language = originalLang
  }
})
```

Verify the mock pattern matches how `i18n.test.ts` mocks `vscode.env.language`. If it uses a `setLang` helper, import that helper instead of inline mocking.

**Validation**: `pnpm test src/test/langToggle.test.ts` — green. `grep "createSpy" src/test/langToggle.test.ts` returns 0 hits.

### Step 9 — `src/test/formatError.test.ts` (FR2 + FR3)

Rename references to the helper, adjust the `new Error()` test expectation.

Before:

```ts
import { formatToggleFailMessage } from '../util/formatError.js'

describe('formatToggleFailMessage (08-26)', () => {
  it.each<[unknown, string]>([
    [new Error('boom'), 'boom'],
    [new TypeError('bad type'), 'bad type'],
    [new Error(), 'Error'],                          // ← already 'Error'? verify
    ...
```

After:

```ts
import { formatErrorMessage } from '../util/formatError.js'

describe('formatErrorMessage (08-27)', () => {
  it.each<[unknown, string]>([
    [new Error('boom'), 'boom'],
    [new TypeError('bad type'), 'bad type'],
    [new Error(), 'Error'],                          // ← updated for FR3
    [{ message: 'string-coerced' }, '[object Object]'],
    ...
```

Verify the existing test file's actual content — the round-2 implementation says "expect `''`" but the round-3 fix changes behavior to `'Error'`. Update the expectation accordingly. Add the explicit regression test:

```ts
it('returns "Error" for new Error() with default empty message (08-27, FR3)', () => {
  expect(formatErrorMessage(new Error())).toBe('Error')
})
```

**Validation**: `pnpm test src/test/formatError.test.ts` — green. `grep "formatToggleFailMessage" src/test/formatError.test.ts` returns 0 hits.

### Step 10 — Full validation gates

```bash
pnpm typecheck
pnpm test

# Static checks (zero matches expected on each):
grep -nE '\(.*as Error\)\.message' src/                          # AC3 — 0 hits
grep -nE 'formatToggleFailMessage' src/                          # FR2 rename complete — 0 hits
grep -nE 'createSpy' src/test/langToggle.test.ts                 # AC8 — 0 hits
grep "spec/i18n.md#manual-language-override" src/                # AC7 — 0 hits (old broken cite)
grep ".trellis/spec/i18n.md#manual-language-override-08-23-ui-lang-toggle" src/  # AC7 — ≥ 1 hit (new cite)
grep "setLangOverride(langStore.currentLang())" .trellis/spec/i18n.md            # AC5 — 0 hits (old spec)
grep "在 set(zh/en) 时" src/util/langStore.ts                                   # AC6 — 0 hits (old JSDoc)
grep "startsWith('zh')" src/i18n/index.ts                         # sanity: 1 hit (round 2 fix held)
tail -c 1 src/test/i18n.test.ts | xxd                            # AC11 — `0a`
```

All green and all grep results as expected.

### Step 11 — Re-run code review

```bash
# In another shell:
/code-review @src/
```

Verify:
- The original 10 round-3 findings are gone.
- No new findings introduced by the round-3 patch.
- If new findings surface, treat them as the next iteration (not this task's scope).

### Step 12 — Commit

```bash
git add -A
git commit -m "fix(i18n): address 10 round-3 code-review findings

- extension.ts:83 activation: read langStore.get() instead of raw langPref
  so setLangOverride tracks the normalized state (invalid cfg like 'fr'
  no longer leaks through the activation path).
- util/formatError: rename formatToggleFailMessage → formatErrorMessage;
  replace (e as Error).message ?? String(e) at 8 unsafe call sites
  (extension.ts:171/449/527/543/548, util/muted.ts:47/60, watcher.ts:93).
- util/formatError: use || (not ??) for empty Error.message fallback so
  new Error() yields 'Error' instead of '' (no more 'Failed to switch UI
  language: ' with trailing colon and empty body).
- spec/i18n.md:27: update to listener pattern (setLangOverride(newPref ===
  'auto' ? undefined : newPref)) — drop obsolete langStore.currentLang() form.
- util/langStore.ts:60: rewrite JSDoc to unambiguously identify
  extension.ts's onDidChangeConfiguration listener as the sole writer
  of setLangOverride.
- extension.ts:406: fix broken spec reference — full path
  .trellis/spec/i18n.md and full github-flavored anchor slug
  (#manual-language-override-08-23-ui-lang-toggle).
- test/langToggle.test.ts: drop dead createSpy variable; add a Chinese
  rendering test that mocks vscode.env.language='zh' so the over-broad
  regex /English|中文/ no longer vacuously passes.
- test/i18n.test.ts:213: comment cites extension.ts:83 (was 80, drifted).
- test/i18n.test.ts: add trailing newline (POSIX).
- test/formatError.test.ts: rename to formatErrorMessage; update
  new Error() expectation to 'Error'; add regression test."
```

## Review gates

- **Before commit**: `pnpm typecheck` + `pnpm test` both green.
- **Before commit**: All 9 grep checks in Step 10 return expected counts.
- **Before commit**: Re-verify diff is scoped to the 9 files listed in design.md "Rollback". No incidental changes.
- **Before commit**: Re-run `/code-review @src/` and verify all 10 findings closed (Step 11).

## Rollback

Single commit. `git revert <commit>` restores prior state. No data migration, no config schema change.

The rename `formatToggleFailMessage` → `formatErrorMessage` is a public API change for any external importer. Internal-only confirmed via `grep` in Step 10.

## Out of scope (re-stated)

- No new languages. No `vscode.l10n` migration.
- No hardcoded Chinese elsewhere in `extension.ts:deactivate` and other toasts.
- No change to `detectLang()` semantics — override priority preserved.
- No restructuring of `LangToggle` to take a `LangStore` instance.
- No moving of override writing back into `LangStore.set()`.
- No removal of the `(08-23 ui-lang-toggle)` parenthetical from the spec heading (would invalidate other cross-references).