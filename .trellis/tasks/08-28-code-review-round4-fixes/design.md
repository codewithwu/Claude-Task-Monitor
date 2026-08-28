# Design — 4 /code-review @src/ findings fixes

## 1. F1 — `formatErrorMessage` 加 duck-typed `.message` 分支

### 现状（`src/util/formatError.ts:20-22`）

```ts
export function formatErrorMessage(e: unknown): string {
  return e instanceof Error ? (e.message || String(e)) : String(e)
}
```

非 Error 对象（如 `workspace.getConfiguration().update()` 在受限 profile 下 reject `{ message: 'Config is system-controlled' }`）一律走 `String(e)` → `'[object Object]'`，把 message 吃掉。

### 设计

三段优先级：

```ts
export function formatErrorMessage(e: unknown): string {
  // 1. Error 实例 — Error.message 是 string | undefined,空字符串兜底 String(e)='Error'
  if (e instanceof Error) return e.message || String(e)
  // 2. duck-typed { message: string } — 包装库 / VS Code API 在受限 profile 下的常见 reject 形态
  if (
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    typeof (e as { message: unknown }).message === 'string'
  ) {
    return (e as { message: string }).message
  }
  // 3. 兜底 — String() 安全处理 null/undefined/number/boolean/普通 object
  return String(e)
}
```

**分支语义**：
- Error 优先：保持现有 `formatError.test.ts` 的 9 个 case 中 6 个不变
- duck-typed 限定 `typeof message === 'string'`：防止 `{ message: null }` / `{ message: 42 }` 这种被错误提升（这些仍然走 `String(e)` = `'[object Object]'`）
- `null`/`undefined` 走兜底 `String(e)` = `'null'`/`'undefined'`

### Test impact

`src/test/formatError.test.ts:9`：

```ts
// 旧
[{ message: 'string-coerced' }, '[object Object]'], // non-Error with message: instanceof false → String(e)
// 新
[{ message: 'string-coerced' }, 'string-coerced'],  // 08-28 F1: duck-typed .message 分支
```

`{ message: null }` 和 `{ message: undefined }` 两个 case 保持 `'[object Object]'`，因为 `typeof message === 'string'` 不满足。

### 兼容性

- 公共 API 签名不变
- 唯一行为变化是"对象有 string `.message`"分支，这正是 PR 期望的修复
- 不破坏现有 6 个 case

## 2. F2 — `LangToggle` fail-soft

### 当前代码（`src/ui/langToggle.ts:29-49`）

```ts
constructor(private readonly getPref: () => LangPref) {
  // ...
  const initial = getPref()
  if (!isLangPref(initial)) {
    throw new Error(`[claude-task-monitor] LangToggle: getPref() returned invalid value "${String(initial)}"...`)
  }
  // ...
  this.render()
}
```

### 风险

构造器 throw 路径在 `extension.ts:195` 是 `new LangToggle(...)`，无 try-catch，错误会冒泡到 `activate()` 的 Promise reject。VS Code 行为：`Cannot activate extension 'claude-task-monitor'`，**整个 extension 命令/UI 全部失效**。

`LangStore` 现在 normalize 所有非法输入，所以 throw 是死代码。但 LangStore 的 normalize 是数据边界责任；如果未来 LangStore 回归（比如 `syncFromConfig()` 漏掉 `isLangPref` 守卫），整个 extension 会一起崩。

### 设计

把"早 throw"换成"warn + UI 兜底 + 自愈"：

```ts
export class LangToggle {
  private readonly item: vscode.StatusBarItem
  // raw 缓存,render() 时拿;LangStore 修正后会通过 onDidChangeConfiguration 触发新 render
  private readonly getPref: () => LangPref

  constructor(getPref: () => LangPref) {
    this.getPref = getPref
    const initial = getPref()
    if (!isLangPref(initial)) {
      // 不抛,只记一次 warn + 容忍渲染
      console.warn(
        `[claude-task-monitor] LangToggle: getPref() returned invalid value ` +
        `"${String(initial)}"; rendering degraded UI until next sync.`
      )
    }
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
    this.item.command = 'claudeTaskMonitor.toggleLanguage'
    this.item.name = 'Language toggle'
    this.render()
    this.item.show()
  }

  render(): void {
    const raw = this.getPref()
    if (isLangPref(raw)) {
      const next = nextPref(raw)
      this.item.text = `$(globe) ${LABELS[raw]}`
      this.item.tooltip = t(
        'lang.toggle.tooltip',
        t(`lang.toggle.state.${raw}`),
        t(`lang.toggle.state.${next}`)
      )
    } else {
      // 退化 UI: ?  + 解释 tooltip; cycle() 后 self-heal
      this.item.text = `$(globe) ?`
      this.item.tooltip = t('lang.toggle.invalid', String(raw))
    }
  }

  dispose(): void { this.item.dispose() }
}
```

**自愈路径**：
1. 用户点按钮 → `cycle()` → `LangStore.set()` 写 config
2. `set()` 内部 `vscode.workspace.getConfiguration().update()` 成功后更新 `this.current` 为合法值
3. `update()` 触发 `onDidChangeConfiguration` → extension.ts 监听器调用 `langToggle.render()`
4. 此时 `getPref()` 返回合法值，`render()` 走正常分支

**为什么不直接调 LangStore**：保持 LangToggle 的窄接口（只读 `() => LangPref`），跟 commit 661d891 的解耦设计一致。LangStore 的 set/cycle/syncFromConfig 由 extension.ts 统一驱动。

### 新增 i18n key

`src/i18n/messages.ts`（或对应翻译表）：

```ts
'lang.toggle.invalid': {
  zh: '语言偏好无效: {0}',
  en: 'Invalid language preference: {0}',
},
```

放在现有 `lang.toggle.*` 簇附近。

### 兼容性

- `LABELS` 不变（合法 pref 路径不变）
- tooltip 在合法 pref 路径下不变
- 异常路径是新行为，但用户可见的 UI（`?` + 描述 tooltip）已经说过是"降级而非崩溃"
- 不抛异常 → `activate()` 永远成功

## 3. F3 — i18n.test.ts suppress warn leak

### 现状（`src/test/i18n.test.ts:223-234`）

```ts
it('activation with invalid cfg normalizes through langStore.get() (08-27, FR1)', async () => {
  setLang('en')
  // LangStore 构造器对非法 pref 回落 'auto' (warn suppressed by vi.spyOn if needed)
  const { LangStore } = await import('../util/langStore.js')
  const langStore = new LangStore('fr' as unknown as ConstructorParameters<typeof LangStore>[0])
  // ...
})
```

注释自己说"warn suppressed by vi.spyOn if needed"，但 spy 没装。

### 修复

```ts
it('activation with invalid cfg normalizes through langStore.get() (08-27, FR1)', async () => {
  setLang('en')
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const { LangStore } = await import('../util/langStore.js')
    const langStore = new LangStore('fr' as unknown as ConstructorParameters<typeof LangStore>[0])
    expect(langStore.get()).toBe('auto')
    const effective = langStore.get()
    setLangOverride(effective === 'auto' ? undefined : effective)
    expect(detectLang()).toBe('en')
  } finally {
    warnSpy.mockRestore()
  }
})
```

复刻 `src/test/langStore.test.ts:160-186` 的范式。

## 4. F4 — extension.ts deactivate() catch 走 helper

### 现状（`src/extension.ts:495-497`）

```ts
} catch (e) {
  console.warn('[claude-task-monitor] uninstall failed:', e)
}
```

这是 `src/util/formatError.ts` 文件头注释（line 18）声明的"extension.ts / muted.ts / watcher.ts 的所有 catch 块都走这里"承诺下，extension.ts 唯一一条没迁移的 catch。

### 修复

```ts
} catch (e) {
  console.warn('[claude-task-monitor] uninstall failed:', formatErrorMessage(e))
}
```

`formatErrorMessage` 已在 `extension.ts:29` import，无需新增 import。

### 行为变化

- 当前 `console.warn` 安全（`String(e)` 对 unknown 都 OK）
- 修完后：
  - `Error('something')` → `'something'`（更精确）
  - `{ message: 'something' }` → `'something'`（受益于 F1 的 duck-typed 分支）
  - `'string'` → `'string'`
  - `null` → `'null'`
- 与文件头注释承诺一致；未来 helper 加行为（截长度、去 CR/LF、清洗凭据）时此路径自动跟随

## 5. 不在范围内

- **不动 LangStore**：LangStore 的 `isLangPref` 守卫 + warn + fallback 仍是数据边界责任
- **不动 muted.ts / watcher.ts**：已经走 helper
- **不动 extension.ts 其他 catch**：已走 helper
- **不改 public API**
