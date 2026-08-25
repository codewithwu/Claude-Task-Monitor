# Design — Fix 5 i18n/lang bugs

## Architecture overview

The i18n/lang subsystem has three layers:

```
┌─────────────────────────────────────────────────────────────────┐
│ UI:  src/ui/langToggle.ts                                        │
│      - Renders status bar button                                 │
│      - Subscribes to lang change events (render() calls)         │
└───────────────────────┬─────────────────────────────────────────┘
                        │ reads via getter (no direct imports)
┌───────────────────────▼─────────────────────────────────────────┐
│ Store: src/util/langStore.ts                                     │
│      - Holds pref state machine (LangPref)                      │
│      - Writes config, reads config (syncFromConfig)              │
│      - Exposes get()/currentLang()/cycle()/set()                 │
└───────────────────────┬─────────────────────────────────────────┘
                        │ calls setLangOverride() on transitions
┌───────────────────────▼─────────────────────────────────────────┐
│ i18n: src/i18n/index.ts                                          │
│      - Module-level override + detectLang()                      │
│      - t() reads override via detectLang()                       │
└─────────────────────────────────────────────────────────────────┘

extension.ts:
  - Reads config at activation, constructs LangStore, sets override
  - onDidChangeConfiguration listener:
      sync → override update → UI refresh
  - toggleLanguage command: cycle() → config update → listener fires
```

The 5 bugs all live in this stack. They cluster around two seams:

1. **The override lifecycle seam** — between `LangStore` and `i18n`: who clears the override when pref returns to `auto`? Currently nobody. (Fixes #1, #4)
2. **The validation seam** — between runtime config and `LangStore`: who rejects invalid pref? Currently only `LangToggle.render()` does, defensively. (Fixes #3, #5)

Plus an isolated defensive fix: the error handler in `extension.ts:327` (Fix #2).

## Change 1 — Add `detectEnvLang()` to bypass override

**File**: `src/i18n/index.ts`

Add a new exported function:

```ts
/**
 * 从 vscode.env.language 解析当前 lang,**不读** module-level override。
 * 用于 pref='auto' 场景:让 UI 跟随环境,而非陈旧 override。
 * detectLang() 仍然存在并保留 override 优先 —— t() 全局走 detectLang。
 */
export function detectEnvLang(): Lang {
  return vscode.env.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
```

`detectLang()` stays unchanged. The distinction is intentional:
- `detectLang()` — what `t()` uses. override takes precedence (test at `src/test/i18n.test.ts:69-73`).
- `detectEnvLang()` — what `LangStore.currentLang()` uses for `auto` only. env only.

## Change 2 — Refactor `LangStore.currentLang()` to use `detectEnvLang()`

**File**: `src/util/langStore.ts:40-42`

```ts
currentLang(): Lang {
  return this.current === 'auto' ? detectEnvLang() : this.current
}
```

Why `detectEnvLang()` and not `detectLang()`:
- `detectLang()` reads override first. If user went `auto → zh → en → auto`, override is still `zh`/`en` from earlier. `detectLang()` returns that, not env. ← This is the bug.
- `detectEnvLang()` ignores override, returns env. `auto` pref is now correctly "follow env", no matter what override is.

Comment update (Fix #4):
```ts
/**
 * 把 pref 解析成实际生效的 lang。
 * - pref='auto' → detectEnvLang() (env only,绕过 module override)
 * - pref='zh'/'en' → 直接返回
 * 注意:'auto' 状态绝不会读 override —— 让 set→auto 循环回到跟随环境,
 * 即使 module override 还残留前一次 set 的值。
 */
```

## Change 3 — Add `isLangPref()` and use it for runtime validation

**File**: `src/util/langStore.ts`

Add near `PREF_ORDER`:

```ts
/**
 * 运行时校验:任意 unknown 是否是合法 LangPref。
 * 供 LangStore 构造器 / syncFromConfig 在手编辑 settings.json / schema 漂移时
 * 退回到 'auto';供 LangToggle.render() 替代手维护的枚举检查。
 */
export function isLangPref(p: unknown): p is LangPref {
  return typeof p === 'string' && (PREF_ORDER as readonly string[]).includes(p)
}
```

Then update `LangStore`:

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

syncFromConfig(): LangPref {
  const cfg = vscode.workspace.getConfiguration('claudeTaskMonitor')
    .get<LangPref>('language', 'auto')
  if (isLangPref(cfg)) {
    this.current = cfg
  } else {
    console.warn(
      `[claude-task-monitor] LangStore: config has invalid language "${String(cfg)}", ` +
      `falling back to "auto".`
    )
    this.current = 'auto'
  }
  return this.current
}
```

`get()` callers and `currentLang()` are unchanged — by the time `LangStore` exposes state, it's already validated.

## Change 4 — Config listener in `extension.ts` clears override on `auto`

**File**: `src/extension.ts:398-406`

```ts
if (e.affectsConfiguration('claudeTaskMonitor.language')) {
  langStore.syncFromConfig()
  // 'auto' 必须显式清空 override,否则 detectLang() 仍读陈旧 override
  // (currentLang() 自身已对 'auto' 走 detectEnvLang,但 spec 要求 setLangOverride
  // 在 pref=auto 时为 undefined,保证 detectLang() 也回落到 env)
  const newPref = langStore.get()
  setLangOverride(newPref === 'auto' ? undefined : newPref)
  statusBar.update(store)
  applyBadge(treeView, store)
  applyJqBanner(treeView, hasJq)
  provider.refresh()
  langToggle.render()
}
```

This is what the spec at `.trellis/spec/i18n.md:20` says should happen. Currently the listener does `setLangOverride(langStore.currentLang())` which, after Change 2, is equivalent (since `currentLang()` returns env for `auto`), but the explicit `undefined` is clearer and matches the spec contract.

Also update the `toggleLanguage` catch block (Fix #2):

```ts
const toggleLanguageCommand = vscode.commands.registerCommand('claudeTaskMonitor.toggleLanguage', async () => {
  try {
    await langStore.cycle()
  } catch (e) {
    void vscode.window.showErrorMessage(
      t('lang.toggle.fail', e instanceof Error ? e.message : String(e))
    )
  }
})
```

## Change 5 — `LangToggle.render()` reuses `isLangPref`

**File**: `src/ui/langToggle.ts`

Delete the local `safePref` function. Import `isLangPref` from `langStore.ts`. Update `render()`:

```ts
render(): void {
  const raw = this.getPref()
  if (!isLangPref(raw)) {
    // 非法 pref (从 syncFromConfig 防御层漏出来的极端情况):显示 '?'
    // 让用户看到异常,tooltip 告知原始值;用户点击 → cycle() 会把任意
    // pref 推进到 PREF_ORDER[0]='auto',自愈到合法值。
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

Net: ~5 lines deleted, single source of truth restored.

## Test design

### `src/test/i18n.test.ts` — add `detectEnvLang` describe block

```ts
describe('detectEnvLang (08-25)', () => {
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

  it('忽略 override —— env=en 但 override=zh 仍返回 en', () => {
    setLang('en')
    setLangOverride('zh')
    expect(detectEnvLang()).toBe('en')
  })
})
```

### `src/test/langStore.test.ts` — 5 new tests

```ts
describe('LangStore.currentLang 与 override 隔离 (08-25)', () => {
  beforeEach(() => {
    setLangOverride(undefined)  // 需要 import 这函数
  })
  afterEach(() => setLangOverride(undefined))

  it('auto 不读 module override', () => {
    setLangOverride('en')  // env=zh, override=en
    expect(new LangStore('auto').currentLang()).toBe('zh')  // 应跟随 env
  })

  it('auto → zh → en → auto: currentLang 回到 env', () => {
    // env 默认是 'en' (mock)
    const s = new LangStore('auto')
    await s.set('zh')
    await s.set('en')
    await s.set('auto')
    expect(s.currentLang()).toBe('en')  // 跟随 env
  })
})

describe('LangStore defensive fallback (08-25)', () => {
  it('构造器收到非法 pref 回落到 auto + console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = new LangStore('fr' as unknown as LangPref)
    expect(s.get()).toBe('auto')
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('syncFromConfig 读到非法 pref 回落到 auto', () => {
    mockConfigValue = 'fr'
    const s = new LangStore('zh')
    expect(s.syncFromConfig()).toBe('auto')
    expect(s.get()).toBe('auto')
  })
})

describe('isLangPref (08-25)', () => {
  it.each(['auto', 'zh', 'en'])('接受 %s', (p) => {
    expect(isLangPref(p)).toBe(true)
  })
  it.each(['fr', 'zh-cn', '', null, undefined, 0, {}])('拒绝 %s', (p) => {
    expect(isLangPref(p as unknown)).toBe(false)
  })
})
```

Note: the second `currentLang` test needs `await` but the describe is sync — bump to `describe('LangStore.currentLang ...', () => { ... it('...', async () => { ... }) })`. Adjust as needed when writing.

## Compatibility

- `detectLang()` exported API unchanged.
- `setLangOverride()` exported API unchanged.
- `LangStore` public surface (`get/currentLang/set/cycle/syncFromConfig`) unchanged in shape, only defensive.
- `LangToggle` constructor + `render()` signature unchanged.
- `extension.ts` listener signature unchanged.
- All changes are internal refinements. No new dependencies. No new public APIs (except `detectEnvLang` and `isLangPref`, both additive).

## Rollback

All changes are localized to 4 source files + 2 test files. `git revert <commit>` recovers cleanly. No migration, no data format change, no persistent state outside `~/.claude/settings.json` (which is the existing config key, unchanged schema).