# Implement — Fix 5 i18n/lang bugs

## Execution order

The fixes are tightly coupled (Changes 2 + 3 + 4 all touch the same override lifecycle; Changes 3 + 5 share `isLangPref`). Apply them in one atomic edit per file:

1. **Step 1** — `src/i18n/index.ts`: add `detectEnvLang()`
2. **Step 2** — `src/util/langStore.ts`: add `isLangPref`, refactor `currentLang()`, harden `constructor` + `syncFromConfig()`, fix comment
3. **Step 3** — `src/extension.ts`: config listener clears override on `auto`; null-safe catch block
4. **Step 4** — `src/ui/langToggle.ts`: delete `safePref`, import `isLangPref`
5. **Step 5** — `src/test/i18n.test.ts`: add `detectEnvLang` tests
6. **Step 6** — `src/test/langStore.test.ts`: add override isolation + defensive fallback + `isLangPref` tests
7. **Step 7** — Run full test suite + typecheck
8. **Step 8** — Run `/code-review @src/` again to verify findings are gone
9. **Step 9** — Spec check (no spec change needed; behavior matches existing `.trellis/spec/i18n.md:20`)
10. **Step 10** — Commit

## Step-by-step

### Step 1 — `src/i18n/index.ts`

After the existing `detectLang()` function (after line 45), add `detectEnvLang()`:

```ts
/**
 * 从 vscode.env.language 解析 lang,**不读** module override。
 * 仅供 LangStore.currentLang() 在 pref='auto' 时使用 —— 让 UI 跟随环境,
 * 不被 module override 残留污染。detectLang() 保留 override 优先语义,
 * 因为 t() 全局需要 override 生效 (08-23 ui-lang-toggle 的设计选择)。
 */
export function detectEnvLang(): Lang {
  return vscode.env.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
```

**Validation**: `pnpm typecheck` clean (no other reference yet).

### Step 2 — `src/util/langStore.ts`

Three coordinated changes in this file.

**(a)** Update import — add `detectEnvLang`:
```ts
import { detectEnvLang } from '../i18n/index.js'
```

**(b)** Add `isLangPref` after `PREF_ORDER`:
```ts
/**
 * 运行时校验:任意 unknown 是否是合法 LangPref。
 * 供 LangStore 构造器 / syncFromConfig 在手编辑 settings.json / schema 漂移时
 * 退回到 'auto';供 LangToggle.render() 替代手维护的合法值枚举。
 * 实现:PREF_ORDER.includes 是单一事实源,新 pref 加入只需改 PREF_ORDER。
 */
export function isLangPref(p: unknown): p is LangPref {
  return typeof p === 'string' && (PREF_ORDER as readonly string[]).includes(p)
}
```

**(c)** Update `currentLang()` + its JSDoc:
```ts
/**
 * 把 pref 解析成实际生效的 lang。
 * - pref='auto' → detectEnvLang() (env only,**不读** module override)
 * - pref='zh'/'en' → 直接返回
 *
 * 为什么 'auto' 走 detectEnvLang 而非 detectLang:
 * module override 在 set(zh/en) 时被 setLangOverride 写入,在 set(auto) 时
 * 必须清空 (由 extension.ts 的 config listener 处理)。但万一 listener 没跑
 * (e.g. 直接 setLangOverride 调用),currentLang 也必须独立于 override 工作。
 * 走 detectEnvLang 让 LangStore 自己对 'auto' 的语义负责,不依赖外部清空动作。
 */
currentLang(): Lang {
  return this.current === 'auto' ? detectEnvLang() : this.current
}
```

**(d)** Harden `constructor`:
```ts
constructor(initial: LangPref) {
  if (!isLangPref(initial)) {
    console.warn(
      `[claude-task-monitor] LangStore: invalid pref "${String(initial)}", ` +
      `falling back to "auto". Valid values: ${PREF_ORDER.join(', ')}`
    )
    this.current = 'auto'
    return
  }
  this.current = initial
}
```

**(e)** Harden `syncFromConfig()`:
```ts
/**
 * 从 config 重读最新值。供 extension.ts 的 onDidChangeConfiguration 监听器调用,
 * 避免在异步 set() 与事件触发之间读到陈旧状态。
 *
 * 防御层:config 里出现非 LangPref 值 (手编辑 settings.json / schema 漂移)
 * 时回落到 'auto' + warn。LangToggle.render() 也会再校验一次,
 * 但那是 UI 兜底 —— 数据层先挡住,避免 UI 看到污染数据。
 */
syncFromConfig(): LangPref {
  const cfg = vscode.workspace.getConfiguration('claudeTaskMonitor')
    .get<LangPref>('language', 'auto')
  if (isLangPref(cfg)) {
    this.current = cfg
    return this.current
  }
  console.warn(
    `[claude-task-monitor] LangStore: config has invalid language "${String(cfg)}", ` +
    `falling back to "auto".`
  )
  this.current = 'auto'
  return this.current
}
```

**Validation**: `pnpm typecheck`. The original `currentLang` `??` operator on line 327 of extension.ts will no longer compile in extension.ts; that's handled in Step 3.

### Step 3 — `src/extension.ts`

Two changes.

**(a)** Listener `claudeTaskMonitor.language` (lines 398-406):

Replace:
```ts
if (e.affectsConfiguration('claudeTaskMonitor.language')) {
  langStore.syncFromConfig()
  setLangOverride(langStore.currentLang())
  // ...
}
```

With:
```ts
if (e.affectsConfiguration('claudeTaskMonitor.language')) {
  langStore.syncFromConfig()
  // 'auto' 必须显式清空 override,否则 detectLang() 仍读陈旧 override
  // (currentLang() 已对 'auto' 走 detectEnvLang 独立,但 spec 要求
  // setLangOverride(undefined) 在 pref=auto 时落地 —— 让 t() 全局也回落到 env)
  const newPref = langStore.get()
  setLangOverride(newPref === 'auto' ? undefined : newPref)
  statusBar.update(store)
  applyBadge(treeView, store)
  applyJqBanner(treeView, hasJq)
  provider.refresh()
  langToggle.render()
}
```

**(b)** `toggleLanguage` catch (lines 322-330):

Replace:
```ts
const toggleLanguageCommand = vscode.commands.registerCommand('claudeTaskMonitor.toggleLanguage', async () => {
  try {
    await langStore.cycle()
  } catch (e) {
    void vscode.window.showErrorMessage(
      t('lang.toggle.fail', (e as Error).message ?? String(e))
    )
  }
})
```

With:
```ts
const toggleLanguageCommand = vscode.commands.registerCommand('claudeTaskMonitor.toggleLanguage', async () => {
  try {
    await langStore.cycle()
  } catch (e) {
    // workspace.getConfiguration().update() 在受限 profile / schema 校验失败时
    // 可能 reject null/undefined 或非 Error 对象 (包装库行为),直接 .message 会
    // 让错误处理本身抛 TypeError —— 用户反而看不到 toast。 instanceof Error
    // 兜底 + String() 兜底,确保所有 reject 路径都打出反馈。
    void vscode.window.showErrorMessage(
      t('lang.toggle.fail', e instanceof Error ? e.message : String(e))
    )
  }
})
```

### Step 4 — `src/ui/langToggle.ts`

**(a)** Update import:
```ts
import { type LangPref, isLangPref, nextPref } from '../util/langStore.js'
```

**(b)** Delete the `safePref` function (lines 26-31):
```ts
// 删除:
function safePref(p: LangPref): LangPref | null {
  return p === 'auto' || p === 'zh' || p === 'en' ? p : null
}
```

**(c)** Update `render()`:
```ts
render(): void {
  const raw = this.getPref()
  if (!isLangPref(raw)) {
    // 非法 pref:理论上 LangStore 已经过滤了,但渲染层兜底 (将来如果有人直接传
    // 非 LangPref 进 LangToggle,这里仍能显示 '?' + tooltip,而不是字面量 'undefined')。
    // 显示 '?' 让用户看到异常;点击 → cycle() 会把任意 pref 推进到 PREF_ORDER[0]='auto'
    // (nextPref: indexOf 不命中 → 0),自愈到合法值,无需专门写 reset 命令。
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
```

### Step 5 — `src/test/i18n.test.ts`

After the `detectLang override` describe block, add:

```ts
describe('detectEnvLang (08-25 fix-i18n-lang-bugs)', () => {
  let originalLang: string
  beforeEach(() => {
    originalLang = vscode.env.language
    setLangOverride(undefined)
  })
  afterEach(() => {
    setLang(originalLang)
    setLangOverride(undefined)
  })

  it('zh-cn → zh', () => {
    setLang('zh-cn')
    expect(detectEnvLang()).toBe('zh')
  })

  it('en-us → en', () => {
    setLang('en-us')
    expect(detectEnvLang()).toBe('en')
  })

  it('ja-jp → en (fallback)', () => {
    setLang('ja-jp')
    expect(detectEnvLang()).toBe('en')
  })

  it('不读 override (env=en 但 override=zh 仍返回 en)', () => {
    setLang('en')
    setLangOverride('zh')
    expect(detectEnvLang()).toBe('en')
  })

  it('不读 override (env=zh 但 override=undefined 仍返回 zh)', () => {
    setLang('zh-cn')
    // setLangOverride(undefined) 已经在 beforeEach 调用
    expect(detectEnvLang()).toBe('zh')
  })
})
```

Need to update the import: add `detectEnvLang` to the `import { ... } from '../i18n/index.js'` line.

### Step 6 — `src/test/langStore.test.ts`

Three new describe blocks at the end of the file.

**(a)** Update import — add `isLangPref, setLangOverride`:
```ts
import { LangStore, nextPref, isLangPref, type LangPref } from '../util/langStore.js'
import { setLangOverride } from '../i18n/index.js'
```

**(b)** After existing `LangStore.currentLang` describe, add:

```ts
describe('LangStore.currentLang 与 module override 隔离 (08-25)', () => {
  beforeEach(() => {
    setLangOverride(undefined)
  })
  afterEach(() => {
    setLangOverride(undefined)
  })

  it('auto 不读 module override —— env=en 但 override=zh 仍跟随 env', () => {
    setLangOverride('zh')  // env 默认 'en'
    expect(new LangStore('auto').currentLang()).toBe('en')
  })

  it('auto → zh → en → auto: 回到 env (en)', async () => {
    const s = new LangStore('auto')
    await s.set('zh')
    await s.set('en')
    await s.set('auto')
    expect(s.currentLang()).toBe('en')
  })
})
```

**(c)** Add defensive fallback tests:

```ts
describe('LangStore defensive fallback (08-25)', () => {
  it('构造器收到非法 pref 回落到 auto + warn 一次', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = new LangStore('fr' as unknown as LangPref)
    expect(s.get()).toBe('auto')
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('构造器收到 null/undefined 也回落', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(new LangStore(null as unknown as LangPref).get()).toBe('auto')
    expect(new LangStore(undefined as unknown as LangPref).get()).toBe('auto')
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('syncFromConfig 读到非法 pref 回落到 auto + warn', () => {
    mockConfigValue = 'fr'
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = new LangStore('zh')
    expect(s.syncFromConfig()).toBe('auto')
    expect(s.get()).toBe('auto')
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
```

**(d)** Add `isLangPref` tests:

```ts
describe('isLangPref (08-25)', () => {
  it.each(['auto', 'zh', 'en'])('接受合法值 %s', (p) => {
    expect(isLangPref(p)).toBe(true)
  })

  it.each(['fr', 'zh-cn', 'en-us', '', 'AUTO', null, undefined, 0, {}, []])(
    '拒绝非法值 %s',
    (p) => {
      expect(isLangPref(p as unknown)).toBe(false)
    }
  )
})
```

### Step 7 — Validation

```bash
pnpm test
pnpm typecheck
```

Expected:
- All existing tests pass (15 i18n + langStore tests unchanged).
- 5 new i18n tests + 7 new langStore tests pass.
- Total tests: 186 + 12 = 198 (give or take; the spec predicts "186 tests" but that's stale).
- `pnpm typecheck` clean.

### Step 8 — Re-run code review

```bash
# 在另一个 shell
/code-review @src/
```

Verify the 5 findings are gone (especially #1: "currentLang() 让 'auto' 永久失效").

If any new findings surface, treat them as the next iteration (not this task's scope).

### Step 9 — Spec check

`.trellis/spec/i18n.md:20` says: "The override is written by `LangStore` on every cycle/set, and cleared (`undefined`) when pref is `auto`."

The new behavior matches this exactly. **No spec change needed**.

(The spec wording is slightly inaccurate — the override is actually written by the config listener in `extension.ts`, not `LangStore` itself. But since the user's experience is "LangStore manages the override" and the listener is the only call site, the spec is effectively correct from the user's perspective. Defer a spec polish as out-of-scope.)

### Step 10 — Commit

```bash
git add -A
git commit -m "fix(i18n): address 5 code-review findings in lang pipeline

- Add detectEnvLang() that bypasses module override; use it in
  LangStore.currentLang() for pref='auto' so cycles back to env.
- Clear setLangOverride(undefined) in extension.ts config listener
  when pref='auto' (spec compliance — i18n.md:20).
- Add isLangPref() typeguard; harden LangStore constructor and
  syncFromConfig with defensive fallback + console.warn.
- LangToggle.render() reuses isLangPref, removing local safePref
  duplicate enumeration (single source of truth via PREF_ORDER).
- Fix extension.ts:327 toggleLanguage catch: instanceof Error +
  String() fallback for null/non-Error rejections.
- Update LangStore.currentLang JSDoc to match actual env-only
  resolution rule for 'auto'.
- 12 new tests covering detectEnvLang, override isolation,
  defensive fallback, isLangPref."
```

## Review gates

- **Before commit**: `pnpm test` + `pnpm typecheck` both green.
- **Before commit**: Re-verify diff is scoped to 4 source files + 2 test files. No incidental changes.
- **Before commit**: No leftover `safePref` reference (grep `safePref` should return nothing).
- **Before commit**: Comment at `LangStore.ts:37` (or wherever the JSDoc ends up post-edit) accurately describes env-only `auto` resolution.

## Rollback

Single commit, four files. `git revert <commit>` restores prior state. No data migration. No config schema change. No persistent state outside `~/.claude/settings.json` (which is the existing key, unchanged).

## Out of scope (re-stated)

- No new languages.
- No `vscode.l10n` migration.
- No hardcoded Chinese elsewhere in `extension.ts`.
- No spec change to `i18n.md` (behavior already matches spec).
- No change to `detectLang()` semantics (override priority preserved for `t()`).