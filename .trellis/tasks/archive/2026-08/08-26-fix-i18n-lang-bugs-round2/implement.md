# Implement — Address 7 code-review findings on i18n/lang pipeline (round 2)

## Execution order

The 7 fixes are mostly independent, but Changes 2 (FR2) and 4 (FR4) touch the i18n key table — Changes 4 first (then 2 won't conflict), and Change 5 (FR5) is spec-only. Apply in dependency order:

1. **Step 1** — Create `src/util/formatError.ts` (FR1 helper extraction)
2. **Step 2** — Edit `src/extension.ts` for FR1 (use the new helper) + FR3 (activation pattern) + FR6 (anchor cite)
3. **Step 3** — Edit `src/i18n/index.ts` for FR2 (`fromEnv()` extraction + header comment)
4. **Step 4** — Edit `src/ui/langToggle.ts` for FR4 (delete guard + constructor check)
5. **Step 5** — Delete `lang.toggle.invalid` from `src/i18n/messages/{en,zh}.ts` (FR4 cleanup)
6. **Step 6** — Edit `.trellis/spec/i18n.md` for FR5 (single-paragraph ownership fix)
7. **Step 7** — Add new test files (`langToggle.test.ts`, `formatError.test.ts`)
8. **Step 8** — Optional small addition to `i18n.test.ts` for FR3 (`detectLang` with `setLangOverride(undefined)`)
9. **Step 9** — Run validation (`pnpm typecheck`, `pnpm test`, `pnpm validate`)
10. **Step 10** — Re-run `/code-review @src/` to verify the 7 findings are gone
11. **Step 11** — Commit

## Step-by-step

### Step 1 — Create `src/util/formatError.ts`

New file. Body:

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

**Validation**: `pnpm typecheck`.

### Step 2 — `src/extension.ts` (FR1 + FR3 + FR6)

Three edits in one file. All in the activation function.

**(a) Add import near the top (after the `LangStore` import):**

```ts
import { formatToggleFailMessage } from './util/formatError.js'
```

**(b) Replace `toggleLanguage` catch (line 328-332):**

```ts
// before:
} catch (e) {
  void vscode.window.showErrorMessage(
    t('lang.toggle.fail', e instanceof Error ? e.message : String(e))
  )
}

// after:
} catch (e) {
  void vscode.window.showErrorMessage(
    t('lang.toggle.fail', formatToggleFailMessage(e))
  )
}
```

**(c) Replace activation pattern (lines 78-80):**

```ts
// before:
const langPref = cfg.get<LangPref>('language', 'auto')
const langStore = new LangStore(langPref)
setLangOverride(langStore.currentLang())

// after:
const langPref = cfg.get<LangPref>('language', 'auto')
const langStore = new LangStore(langPref)
// 与 onDidChangeConfiguration 监听器 (L408) 对齐:auto 写 undefined,
// 让 t() 全局也回落到 env (spec spec/i18n.md#manual-language-override)
setLangOverride(langPref === 'auto' ? undefined : langPref)
```

**(d) Replace `:20` line cite (lines 402-405):**

```ts
// before:
// 'auto' 必须显式清空 override (08-25):LangStore.currentLang() 已对 'auto' 走
// detectEnvLang 独立工作,但 spec (.trellis/spec/i18n.md:20) 要求
// setLangOverride(undefined) 在 pref=auto 时落地 —— 让 t() 全局也回落到 env。

// after:
// 'auto' 必须显式清空 override (08-25):LangStore.currentLang() 已对 'auto' 走
// detectEnvLang 独立工作,但 spec (spec/i18n.md#manual-language-override) 要求
// setLangOverride(undefined) 在 pref=auto 时落地 —— 让 t() 全局也回落到 env。
```

**Validation**: `pnpm typecheck`. The `e instanceof Error` ternary is gone; the only error handling for `toggleLanguage` now goes through `formatToggleFailMessage`.

### Step 3 — `src/i18n/index.ts` (FR2)

Two edits.

**(a) Update header comment (lines 8-10):**

```ts
// before:
//   - vscode.env.language 以 'zh' 开头 → 中文
//   - 其他 → 英文 (默认 fallback)
//   - 缺失 key → 返回 key 本身,console.warn 一次 (避免 typo 默默走 fallback)

// after:
//   - vscode.env.language 以 'zh' 开头 → 中文  (fromEnv, 单一事实源)
//   - 其他 → 英文 (默认 fallback)             (同上)
//   - 缺失 key → 返回 key 本身,console.warn 一次 (避免 typo 默默走 fallback)
```

**(b) Extract `fromEnv()` and update both detect functions (lines 42-55):**

```ts
// before:
export function detectLang(): Lang {
  if (override) return override
  return vscode.env.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/**
 * 从 vscode.env.language 解析 lang,**不读** module override。
 * 仅供 LangStore.currentLang() 在 pref='auto' 时使用 —— 让 UI 跟随环境,
 * 不被 module override 残留污染。detectLang() 保留 override 优先语义,
 * 因为 t() 全局需要 override 生效 (08-23 ui-lang-toggle 的设计选择)。
 */
export function detectEnvLang(): Lang {
  return vscode.env.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

// after:
/** 从 vscode.env.language 解析 lang。单一事实源:detectLang 和 detectEnvLang 都走这里。 */
function fromEnv(): Lang {
  return vscode.env.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function detectLang(): Lang {
  return override ?? fromEnv()
}

/**
 * 从 vscode.env.language 解析 lang,**不读** module override。
 * 仅供 LangStore.currentLang() 在 pref='auto' 时使用 —— 让 UI 跟随环境,
 * 不被 module override 残留污染。detectLang() 保留 override 优先语义,
 * 因为 t() 全局需要 override 生效 (08-23 ui-lang-toggle 的设计选择)。
 */
export function detectEnvLang(): Lang {
  return fromEnv()
}
```

**Validation**: `grep "startsWith('zh')" src/i18n/index.ts` returns exactly 1 hit. `pnpm typecheck`.

### Step 4 — `src/ui/langToggle.ts` (FR4)

Three edits.

**(a) Delete the `if (!isLangPref(raw))` branch (lines 46-54):**

```ts
// before:
render(): void {
  const raw = this.getPref()
  if (!isLangPref(raw)) {
    // 非法 pref:理论上 LangStore 已经过滤了 (构造器 / syncFromConfig 都会校验),
    // 但渲染层兜底 —— 万一有人直接传非 LangPref 进 LangToggle,这里仍能显示 '?' +
    // tooltip,而不是字面量 'undefined'。点击 → cycle() 会把任意 pref 推进到
    // PREF_ORDER[0]='auto' (nextPref: indexOf 不命中 → 0),自愈到合法值。
    this.item.text = '$(globe) ?'
    this.item.tooltip = t('lang.toggle.invalid', raw)
    return
  }
  const next = nextPref(raw)
  this.item.text = `$(globe) ${LABELS[raw]}`
  this.item.tooltip = t(
    'lang.toggle.tooltip',
    t(`lang.toggle.state.${raw}`),
    t(`lang.toggle.state.${next}`)
  )
}

// after:
render(): void {
  const raw = this.getPref()  // 构造时已校验 (见 constructor)
  const next = nextPref(raw)
  this.item.text = `$(globe) ${LABELS[raw]}`
  this.item.tooltip = t(
    'lang.toggle.tooltip',
    t(`lang.toggle.state.${raw}`),
    t(`lang.toggle.state.${next}`)
  )
}
```

**(b) Add construction-time check (replace `constructor` lines 29-38):**

```ts
// before:
constructor(private readonly getPref: () => LangPref) {
  this.item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    99
  )
  this.item.command = 'claudeTaskMonitor.toggleLanguage'
  this.item.name = 'Language toggle'
  this.render()
  this.item.show()
}

// after:
constructor(private readonly getPref: () => LangPref) {
  // 防御层 (08-26):getPref 契约是 () => LangPref,但 LangStore 是数据边界 —
  // 任何绕过 LangStore 的 LangPref 生产者都应在此处早 throw,而不是在
  // render 每次触发时静默回退 (08-25 之前的 safePref 模式)。
  // 这一行只跑一次,运行时零开销。
  const initial = getPref()
  if (!isLangPref(initial)) {
    throw new Error(
      `[claude-task-monitor] LangToggle: getPref() returned invalid value ` +
      `"${String(initial)}"; LangStore should be the data boundary.`
    )
  }
  this.item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    99
  )
  this.item.command = 'claudeTaskMonitor.toggleLanguage'
  this.item.name = 'Language toggle'
  this.render()
  this.item.show()
}
```

**Validation**: `pnpm typecheck`. `grep "lang.toggle.invalid" src/` should return 0 hits after Step 5.

### Step 5 — Delete `lang.toggle.invalid` from messages

Two edits.

**(a) `src/i18n/messages/en.ts` — remove line 76:**

```ts
// before:
  'lang.toggle.tooltip': 'UI language: {0}\nClick to switch to {1}\nCommand palette names follow VS Code display language',
  'lang.toggle.invalid': "UI language: invalid value '{0}'\nClick to reset to auto",
  'lang.toggle.fail': 'Failed to switch UI language: {0}'

// after:
  'lang.toggle.tooltip': 'UI language: {0}\nClick to switch to {1}\nCommand palette names follow VS Code display language',
  'lang.toggle.fail': 'Failed to switch UI language: {0}'
```

**(b) `src/i18n/messages/zh.ts` — remove line 76:**

```ts
// before:
  'lang.toggle.tooltip': '界面语言: {0}\n点击切换到 {1}\n命令面板名称跟随 VS Code display language',
  'lang.toggle.invalid': "界面语言: 无效值 '{0}'\n点击重置为自动",
  'lang.toggle.fail': '切换界面语言失败:{0}'

// after:
  'lang.toggle.tooltip': '界面语言: {0}\n点击切换到 {1}\n命令面板名称跟随 VS Code display language',
  'lang.toggle.fail': '切换界面语言失败:{0}'
```

**Validation**: `pnpm test` — the symmetry test in `src/test/i18n.test.ts` should still pass (it compares the two tables).

### Step 6 — `.trellis/spec/i18n.md` (FR5)

Single paragraph edit in the "Manual language override" section. Find and replace:

```md
// before:
The override is written by `LangStore` (`src/util/langStore.ts`) on every cycle/set, and cleared (`undefined`) when pref is `auto`. All `t()` callers benefit transparently — no signature changes.

// after:
The override is written by `extension.ts`'s `onDidChangeConfiguration` listener (single channel; see `src/extension.ts` ~L408) on every `claudeTaskMonitor.language` config change, and cleared (`undefined`) when the new pref is `auto`. `LangStore` itself does not touch the override — it stays decoupled from the i18n layer so the store can be unit-tested without VS Code's i18n state. All `t()` callers benefit transparently — no signature changes.
```

**Validation**: `pnpm validate` (if it exists for spec), else `grep "written by \`LangStore\`" .trellis/spec/i18n.md` returns 0 hits.

### Step 7 — New test files (FR7)

#### `src/test/langToggle.test.ts` (new)

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
  let createSpy: MockInstance

  beforeEach(() => {
    item = mockItem()
    createSpy = vi
      .spyOn(vscode.window, 'createStatusBarItem')
      .mockReturnValue(item as unknown as vscode.StatusBarItem)
  })

  it('renders auto: text = $(globe) A, show() called', () => {
    new LangToggle(() => 'auto')
    expect(item.text).toBe('$(globe) A')
    expect(item.tooltip).toContain('UI language')
    expect(item.show).toHaveBeenCalledTimes(1)
  })

  it('renders zh: text = $(globe) 中, tooltip mentions next = en', () => {
    new LangToggle(() => 'zh')
    expect(item.text).toBe('$(globe) 中')
    // nextPref(zh) = 'en' → tooltip should mention English state
    expect(item.tooltip).toMatch(/English|英文/)
  })

  it('renders en: text = $(globe) EN, tooltip mentions next = auto', () => {
    new LangToggle(() => 'en')
    expect(item.text).toBe('$(globe) EN')
    // nextPref(en) = 'auto' → tooltip should mention Auto state
    expect(item.tooltip).toMatch(/Auto|自动/)
  })

  it('render() reflects getter change (no internal caching)', () => {
    let pref: LangPref = 'auto'
    const t = new LangToggle(() => pref)
    expect(item.text).toBe('$(globe) A')

    pref = 'zh'
    t.render()
    expect(item.text).toBe('$(globe) 中')

    pref = 'en'
    t.render()
    expect(item.text).toBe('$(globe) EN')
  })

  it('dispose() disposes the underlying StatusBarItem', () => {
    const t = new LangToggle(() => 'auto')
    t.dispose()
    expect(item.dispose).toHaveBeenCalledTimes(1)
  })

  it('constructor throws if getPref returns invalid value (defense shift, R1)', () => {
    expect(() =>
      new LangToggle(() => 'fr' as unknown as LangPref)
    ).toThrow(/LangToggle/)
  })

  it('command is set to claudeTaskMonitor.toggleLanguage', () => {
    new LangToggle(() => 'auto')
    expect(item.command).toBe('claudeTaskMonitor.toggleLanguage')
  })

  it('priority is 99 (sibling to CTM at 100)', () => {
    new LangToggle(() => 'auto')
    expect(item.priority).toBe(99)
  })
})
```

#### `src/test/formatError.test.ts` (new)

```ts
import { describe, it, expect } from 'vitest'
import { formatToggleFailMessage } from '../util/formatError.js'

describe('formatToggleFailMessage (08-26)', () => {
  it.each<[unknown, string]>([
    [new Error('boom'), 'boom'],
    [new TypeError('bad type'), 'bad type'],
    [new Error(), 'Error'],                          // default message → String(e) = 'Error'
    [{ message: 'string-coerced' }, '[object Object]'], // non-Error with message: instanceof false → String(e)
    [{ message: null }, '[object Object]'],
    [{ message: undefined }, '[object Object]'],
    ['string-reject', 'string-reject'],
    [null, 'null'],
    [undefined, 'undefined'],
    [42, '42'],
    [true, 'true'],
  ])('formats %p → %p', (input, expected) => {
    expect(formatToggleFailMessage(input)).toBe(expected)
  })

  it('never returns the literal {0} template placeholder', () => {
    expect(formatToggleFailMessage(new Error())).not.toContain('{0}')
    expect(formatToggleFailMessage({ message: null })).not.toContain('{0}')
    expect(formatToggleFailMessage(undefined)).not.toContain('{0}')
    expect(formatToggleFailMessage(null)).not.toContain('{0}')
  })

  it('handles Error subclass with undefined message', () => {
    class CustomError extends Error {
      constructor() {
        super()
        this.message = undefined as unknown as string
      }
    }
    expect(formatToggleFailMessage(new CustomError())).toBe('Error')
  })
})
```

**Validation**: `pnpm test src/test/langToggle.test.ts src/test/formatError.test.ts` — both green.

### Step 8 — Optional addition to `src/test/i18n.test.ts` (FR3)

After the existing `detectEnvLang (08-25)` describe block, add one test verifying the activation pattern:

```ts
describe('activation pattern (08-26, FR3)', () => {
  it('setLangOverride(undefined) + env=en → detectLang returns en', () => {
    setLang('en')
    setLangOverride(undefined)              // simulates extension.ts:80 with pref='auto'
    expect(detectLang()).toBe('en')
  })

  it('setLangOverride(undefined) + env=zh → detectLang returns zh', () => {
    setLang('zh-cn')
    setLangOverride(undefined)
    expect(detectLang()).toBe('zh')
  })
})
```

`detectLang` and `setLangOverride` are already imported. `setLang` is the existing test helper that mocks `vscode.env.language`.

**Validation**: `pnpm test src/test/i18n.test.ts` green.

### Step 9 — Full validation

```bash
pnpm typecheck
pnpm test
grep "startsWith('zh')" src/i18n/index.ts   # expect: 1 hit
grep "safePref" src/                          # expect: 0 hits
grep "lang.toggle.invalid" src/               # expect: 0 hits
grep "langStore writes" .trellis/spec/i18n.md # expect: 0 hits
grep "i18n.md:20" src/                        # expect: 0 hits
```

All green and zero matches on the deletion greps.

### Step 10 — Re-run code review

```bash
# In another shell:
/code-review @src/
```

Verify:
- The original 7 findings are gone.
- No new findings introduced by the refactor.
- If new findings surface, treat them as the next iteration (not this task's scope).

### Step 11 — Commit

```bash
git add -A
git commit -m "fix(i18n): address 7 code-review findings (round 2)

- extension.ts:330 toast: extract formatToggleFailMessage helper with
  String() fallback on both branches of instanceof check (Error.message
  === null/undefined no longer leaks {0} template placeholder).
- i18n/index.ts: extract private fromEnv() helper; detectLang and
  detectEnvLang both route through it (single source for env-language
  resolution).
- extension.ts:80 activation: setLangOverride(auto ? undefined : pref)
  matches listener pattern; override is consistently undefined for
  pref='auto' regardless of code path.
- ui/langToggle.ts: delete unreachable defensive branch (getPref is
  typed () => LangPref; LangStore is data boundary); move the one-time
  check to constructor throw.
- Remove lang.toggle.invalid key from messages/en.ts and messages/zh.ts.
- spec/i18n.md: correct override ownership paragraph — written by
  extension.ts config listener, not LangStore (the listener owns it
  so LangStore stays decoupled from i18n for unit-testability).
- extension.ts: replace brittle ':20' line cite with stable
  spec/i18n.md#manual-language-override anchor.
- New tests: langToggle.test.ts (8 cases), formatError.test.ts
  (11 cases), + 2 cases in i18n.test.ts for FR3."
```

## Review gates

- **Before commit**: `pnpm typecheck` + `pnpm test` both green.
- **Before commit**: All 5 grep checks in Step 9 return expected counts.
- **Before commit**: Re-verify diff is scoped to: `src/extension.ts`, `src/i18n/index.ts`, `src/i18n/messages/{en,zh}.ts`, `src/ui/langToggle.ts`, `src/util/formatError.ts` (new), `src/test/langToggle.test.ts` (new), `src/test/formatError.test.ts` (new), `src/test/i18n.test.ts` (small addition), `.trellis/spec/i18n.md`. No incidental changes.
- **Before commit**: No leftover `safePref` reference anywhere (was removed in 08-25, just confirming round-2 didn't reintroduce).
- **Before commit**: Spec change is verified by `pnpm validate` if the script exists.

## Rollback

Single commit. `git revert <commit>` restores prior state. No data migration, no config schema change. The `formatError` module is new and can be deleted with the rest of the revert. The `lang.toggle.invalid` key removal is reversible (both tables revert together).

## Out of scope (re-stated)

- No new languages. No `vscode.l10n` migration.
- No hardcoded Chinese elsewhere in `extension.ts:deactivate` (412-413) and 5 other toasts.
- No change to `detectLang()` semantics — override priority is preserved for `t()`.
- No restructuring of `LangToggle` to take a `LangStore` instance — getter contract stays narrow.
- No moving of override writing back into `LangStore.set()` — that would couple to i18n module, contradict 08-25 design.
