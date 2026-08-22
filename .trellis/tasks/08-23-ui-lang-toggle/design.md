# Design — UI 中英文切换按钮

> 与 `prd.md` 配套,记录技术架构、数据流、关键 tradeoff。

## 1. 架构总览

```
              ┌──────────────────────────────────────┐
              │  package.json (新增)                  │
              │  - claudeTaskMonitor.language 配置     │
              │  - claudeTaskMonitor.toggleLanguage 命令│
              └──────────────┬───────────────────────┘
                             │ 读取/写入
                             ▼
   ┌─────────────────────────────────────────────────────────┐
   │  LangStore (src/util/langStore.ts) — 单例 per activation │
   │  - state: LangPref ('auto' | 'zh' | 'en')              │
   │  - get(): LangPref                                       │
   │  - currentLang(): Lang (resolved, 'auto' → vscode.env)  │
   │  - set(pref): Promise<void>  // 写 config               │
   │  - cycle(): Promise<LangPref>  // A → 中 → EN → A      │
   │  - syncFromConfig(): void  // 重读 config (供 ext 调)   │
   └─────────────────────────────────────────────────────────┘
            │             │              │
            │             │              │
            ▼             ▼              ▼
       setLangOverride  StatusBar    TreeProvider
       (i18n 模块级变量)  (LangToggle  (refresh)
                          status bar 
                          item)
```

**核心不变量**:`detectLang()` 优先返回 override,缺省时回落到 `vscode.env.language`。所有 `t()` 调用天然 reactive,无需改签名。

## 2. 模块设计

### 2.1 `src/i18n/index.ts` — 新增 override 机制

```ts
let override: Lang | undefined  // 模块级可变状态

export function setLangOverride(lang: Lang | undefined): void {
  override = lang
}

export function detectLang(): Lang {
  if (override) return override
  return vscode.env.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
```

- **不破坏现有 API**:`t(key, ...args, lang?)` 的 lang override 仍走最后参数语义,未变。
- **测试隔离**:测试通过显式 `setLangOverride(undefined)` 在 afterEach 重置。
- **副作用范围**:整个 i18n 模块只此一处修改,38 个现有 key 全部继续工作。

### 2.2 `src/util/langStore.ts` (新文件)

LangStore 是 pref 状态的唯一来源。**自身不发事件**——extension.ts 监听 `onDidChangeConfiguration` 后统一刷新,避免双触发。

```ts
export type LangPref = 'auto' | 'zh' | 'en'
export type Lang = 'zh' | 'en'

const PREF_ORDER: LangPref[] = ['auto', 'zh', 'en']

export class LangStore {
  private current: LangPref
  constructor(initial: LangPref) { this.current = initial }
  get(): LangPref { return this.current }
  currentLang(): Lang {
    return this.current === 'auto' ? detectFromEnv() : this.current
  }
  async set(pref: LangPref): Promise<void> {
    if (pref === this.current) return
    this.current = pref
    await vscode.workspace.getConfiguration('claudeTaskMonitor')
      .update('language', pref, vscode.ConfigurationTarget.Global)
  }
  async cycle(): Promise<LangPref> {
    const i = PREF_ORDER.indexOf(this.current)
    const next = PREF_ORDER[(i + 1) % PREF_ORDER.length]
    await this.set(next)
    return next
  }
  syncFromConfig(): void {
    this.current = readPrefFromConfig()
  }
  dispose(): void { /* no-op, no resources held */ }
}
```

设计要点:
- **set 幂等**:同 pref 重复设不写 config,避免 VS Code 误判"用户改了配置"。
- **cycle 永远前进**:en → auto 也是有效转移。
- **不持有 EventEmitter**:事件由 `onDidChangeConfiguration` 统一驱动,降低耦合。

### 2.3 `src/ui/langToggle.ts` (新文件)

一个独立的 StatusBarItem。文本是当前 pref 的短标签,tooltip 是 i18n 化的多行说明。

```ts
export class LangToggle {
  private readonly item: vscode.StatusBarItem
  constructor(private readonly store: LangStore) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right, 99
    )
    this.item.command = 'claudeTaskMonitor.toggleLanguage'
    this.item.name = 'Language toggle'
    this.render()
    this.item.show()
  }
  render(): void {
    const pref = this.store.get()
    const next = nextPref(pref)
    this.item.text = `$(globe) ${LABELS[pref]}`
    this.item.tooltip = t(
      'lang.toggle.tooltip',
      t(`lang.toggle.state.${pref}`),
      t(`lang.toggle.state.${next}`)
    )
  }
  dispose(): void { this.item.dispose() }
}

const LABELS = { auto: 'A', zh: '中', en: 'EN' } as const  // 短标签不 i18n
```

设计要点:
- **优先级 99**:紧邻现有 StatusBar (priority 100),逻辑分组。
- **Codicon `$(globe)`**:VS Code 原生主题感知图标。
- **短标签硬编码**:A/中/EN 是符号,不是文案。
- **render() 公开**:外部可在 refresh 路径调用,无需订阅。

## 3. 数据流 (用户点按钮)

```
1. User 点 status bar 按钮
       ↓
2. vscode 触发命令 claudeTaskMonitor.toggleLanguage
       ↓
3. langStore.cycle() → langStore.set(nextPref)
       ↓
4. workspace.getConfiguration().update('language', nextPref, Global)
       ↓
5. VS Code 触发 onDidChangeConfiguration('claudeTaskMonitor.language')
       ↓
6. extension.ts 监听器:
   a. langStore.syncFromConfig()  // 读最新 pref
   b. setLangOverride(langStore.currentLang())  // i18n 立即生效
   c. statusBar.update(store)  // CTM 文字/tooltip 刷新
   d. applyBadge(treeView, store)  // badge tooltip 刷新
   e. provider.refresh()  // tree description 刷新
   f. langToggle.render()  // 按钮自身文字/tooltip 刷新
```

**关键属性**:
- 全过程无 reload,无 await setOverride 之外的延迟。
- 所有 `t()` 调用通过 detectLang() 读 override → 已立即生效。
- "lang changed" 通过 config 写入这一**单一通道**广播,避免双触发。

## 4. 配置项 schema

`package.json` 新增:

```json
"claudeTaskMonitor.language": {
  "type": "string",
  "enum": ["auto", "zh", "en"],
  "default": "auto",
  "description": "UI 语言。auto = 跟随 VS Code display language;zh/en 强制覆盖动态文案 (status bar / sidebar / toast / notification)。Command Palette / 视图标题 / Welcome 内容仍由 VS Code display language 决定。"
}
```

**作用域**:`ConfigurationTarget.Global` — 个人偏好,跨工作区。

**description 写成中文**沿用既有 8 个配置项的中文 description 风格。

## 5. 范围 (In / Out)

### In Scope
- `LangStore` 单例 + 3 状态循环
- 独立 `LangToggle` StatusBarItem (priority 99)
- `setLangOverride()` module 变量 + `detectLang()` 优先返回
- 5 个新 i18n key (对称加到 en.ts / zh.ts)
- 1 个新 `package.nls.json` key (toggleLanguage command title)
- 1 个新 `package.json` 配置项 (`claudeTaskMonitor.language`)
- 1 个新命令 (`claudeTaskMonitor.toggleLanguage`)
- refresh 路径接入 (`onDidChangeConfiguration`)
- 测试:LangStore 单测 + i18n override 单测

### Out of Scope (明示不做)
- **Command Palette 命令标题 / 视图标题 / Welcome 内容** 切换 —— 平台硬限制,运行时改不了。Tooltip 内诚实告知。
- 新增第三种语言 (ja / ko 等)。
- 迁移到 `vscode.l10n`。
- workspaceState 双层覆盖 (config-only,用户级)。
- 修改 `deactivate()` 中的硬编码中文 toast (沿用 08-23-fix-v020-leftovers 的 deferred 状态)。
- 修改 5 处 extension.ts 内的硬编码中文 toast (同上)。

## 6. 兼容性 & 风险

| 风险 | 缓解 |
|---|---|
| i18n module-level mutable 难调试 | 命名清晰 (override),单点设值,测试覆盖 reset |
| onDidChangeConfiguration 顺序问题 (toggle 写 config → 监听器读 → setLangOverride) | 测试覆盖「写完 → override 已生效」端到端流程 |
| 现有测试 `vi.mock('vscode', ...)` 不影响 override | override 在 mock 的 vscode 之外,i18n.test.ts 加一组新测试覆盖 |
| `package.nls.json` 对称性无自动测试 | 新增 1 个 key (toggleLanguage title),手核对称 |
| 用户从 Settings UI 直接改 `language` 字段 | LangStore.syncFromConfig() 统一处理,无需重启 |
| StatusBar 加新 item 占用视觉空间 | priority 99 与 CTM (100) 紧邻,5 字符宽度可接受 |

## 7. Rollback

如果生产发现严重问题:
1. revert 整个 git commit
2. 删除 `claudeTaskMonitor.language` 配置项 (若用户已设置过,需手动改回 'auto')
3. `LangToggle` StatusBarItem 不存在,UI 恢复原状
4. `t()` 通过 `detectLang()` 退回纯 env 检测,等价于未改动状态

无 schema migration、无数据迁移、无 reload 副作用。

## 8. 不需 design.md 但仍要跟踪的细节

- `src/test/langStore.test.ts` — 8 个测试覆盖 cycle/sync/set/case
- `src/test/i18n.test.ts` — 加 1 个 describe block 覆盖 `detectLang` override 行为
- README 不动 (新增功能不在用户首要关注路径)
