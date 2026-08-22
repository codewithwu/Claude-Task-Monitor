# Implement — UI 中英文切换按钮

> 与 `prd.md` + `design.md` 配套。执行清单,按依赖顺序排列。

## 实施顺序

### Phase A: i18n override 机制 (foundation)

- [ ] **A1** 修改 `src/i18n/index.ts`:
  - 顶部添加 `let override: Lang | undefined`
  - 新增 export `setLangOverride(lang: Lang | undefined): void`
  - 修改 `detectLang()`:override 存在则返回 override,否则 fallback 到 `vscode.env.language`
  - 顶部注释加一行说明 override 用途与生命周期
- [ ] **A2** 验证现有 i18n.test.ts 全部通过 (override 不存在时 detectLang 行为不变)

### Phase B: LangStore 核心

- [ ] **B1** 新建 `src/util/langStore.ts`:
  - export type `LangPref = 'auto' | 'zh' | 'en'`
  - `PREF_ORDER: LangPref[] = ['auto', 'zh', 'en']`
  - `class LangStore` 实现 get/set/cycle/currentLang/syncFromConfig/dispose
  - import vscode (顶部)
- [ ] **B2** 新建 `src/test/langStore.test.ts`:
  - `vi.mock('vscode', ...)` 配置 workspace.getConfiguration (mock update + get) 和 env.language='en'
  - 测试 8 个 case (见 acceptance criteria B)

### Phase C: 配置项 + 命令注册

- [ ] **C1** 修改 `package.json`:
  - 在 `contributes.configuration.properties` 添加 `claudeTaskMonitor.language` (description 用中文,沿用风格)
  - 在 `contributes.commands` 数组添加 `claudeTaskMonitor.toggleLanguage` (title 用 `%command.toggleLanguage.title%`)
- [ ] **C2** 修改 `package.nls.json`:添加 `"command.toggleLanguage.title": "Switch UI Language"`
- [ ] **C3** 修改 `package.nls.zh-cn.json`:添加 `"command.toggleLanguage.title": "切换界面语言"`
- [ ] **C4** 手核 `package.nls.json` ↔ `package.nls.zh-cn.json` key 对称

### Phase D: i18n 消息表新增 keys

- [ ] **D1** 修改 `src/i18n/messages/en.ts`,新增 keys (按 area 分组,加注释 `─── lang toggle ───`):
  - `lang.toggle.state.auto`: 'Auto'
  - `lang.toggle.state.zh`: 'Chinese'
  - `lang.toggle.state.en`: 'English'
  - `lang.toggle.tooltip`: 'UI language: {0}\nClick to switch to {1}\nCommand palette names follow VS Code display language'
- [ ] **D2** 修改 `src/i18n/messages/zh.ts`,对应新增:
  - `lang.toggle.state.auto`: '自动'
  - `lang.toggle.state.zh`: '中文'
  - `lang.toggle.state.en`: '英文'
  - `lang.toggle.tooltip`: '界面语言: {0}\n点击切换到 {1}\n命令面板名跟随 VS Code display language'
- [ ] **D3** 跑 `pnpm test` 验证 `src/test/i18n.test.ts` 对称测试通过

### Phase E: LangToggle StatusBarItem

- [ ] **E1** 新建 `src/ui/langToggle.ts`:
  - import `vscode` + `LangStore` + `t`
  - `class LangToggle` 含 `item`、`render()`、`dispose()`
  - 硬编码 `LABELS = { auto: 'A', zh: '中', en: 'EN' }`
  - `nextPref(pref)` helper (cycle 内部状态计算)
  - text 格式:`` `$(globe) ${LABELS[pref]}` ``
  - tooltip:`t('lang.toggle.tooltip', t(\`lang.toggle.state.${pref}\`), t(\`lang.toggle.state.${next}\`))`

### Phase F: extension.ts 接入

- [ ] **F1** 在 `extension.ts` import 区添加:
  - `import { LangStore, type LangPref } from './util/langStore.js'`
  - `import { setLangOverride } from './i18n/index.js'`
  - `import { LangToggle } from './ui/langToggle.js'`
- [ ] **F2** 在 `activate` 顶部配置读取块添加:
  ```ts
  const langPref = cfg.get<LangPref>('language', 'auto')
  const langStore = new LangStore(langPref)
  setLangOverride(langStore.currentLang())
  ```
  位置:`staleHours` 等 config 读取后、Notifier 构造前。
- [ ] **F3** 注册命令 `claudeTaskMonitor.toggleLanguage`:
  ```ts
  vscode.commands.registerCommand('claudeTaskMonitor.toggleLanguage', () => langStore.cycle())
  ```
  push 进 `context.subscriptions`。
- [ ] **F4** 在 activate 末尾构造 `LangToggle`:
  ```ts
  const langToggle = new LangToggle(langStore)
  ```
  push 进 `context.subscriptions`。
- [ ] **F5** 扩展 `onDidChangeConfiguration` 监听器:
  ```ts
  if (e.affectsConfiguration('claudeTaskMonitor.language')) {
    langStore.syncFromConfig()
    setLangOverride(langStore.currentLang())
    statusBar.update(store)
    applyBadge(treeView, store)
    provider.refresh()
    langToggle.render()
  }
  ```
  复用现有 `syncWaitingDependentUI` 模式,把现有 `longWaitingThresholdSec` 分支并列处理。

### Phase G: 测试 & 验证

- [ ] **G1** `pnpm test` 全部通过 (包括新增的 langStore.test.ts 和 i18n.test.ts 新增的 override 测试)
- [ ] **G2** 手测脚本:
  ```bash
  # 1. 打开 VS Code,激活扩展
  # 2. 检查 status bar 出现 $(globe) A 按钮
  # 3. 点 1 次 → $(globe) 中,status bar 文字/tooltip 变中文,sidebar tree description 变中文
  # 4. 点 1 次 → $(globe) EN,所有动态文案变英文
  # 5. 点 1 次 → $(globe) A,跟随 vscode.env.language (zh-CN → 中文)
  # 6. 打开 Preferences > Settings,搜 claudeTaskMonitor.language,改成 'zh',按钮立刻变 $(globe) 中
  # 7. 改回 'auto',验证回退到 env
  ```

## 关键 Acceptance Criteria 复现 (详见 prd.md)

### B. LangStore 单测 (8 项)
1. 初始值 'auto' → cycle 后 'zh'
2. 初始 'zh' → cycle 后 'en'
3. 初始 'en' → cycle 后 'auto' (loop)
4. set 相同 pref → 不写 config
5. set 不同 pref → 调 workspace.update
6. currentLang 在 'auto' + env='en' → 'en'
7. currentLang 在 'zh' → 'zh'
8. syncFromConfig 读最新值

### i18n 对称测试
- 加完 4 个新 key 后,`src/test/i18n.test.ts` symmetry test 仍通过

### E2E (手测)
- 4 个状态循环点按如预期
- Settings UI 改 language 后立即生效 (无需 reload)
- tooltip 末尾"Command palette names follow VS Code display language"显示正确

## 验证命令

```bash
# 单元测试
pnpm test 2>&1 | grep -E "(i18n|LangStore|FAIL|PASS|✓|✗|×)"

# 编译检查
pnpm build 2>&1 | tail -20

# 打包测试 (可选)
pnpm package 2>&1 | tail -5
```

## 风险点 & 回滚

| 步骤 | 风险 | 回滚 |
|---|---|---|
| A1 | override 模块级可变状态被忘重置 | 在 i18n.test.ts 加 afterEach 显式 `setLangOverride(undefined)` |
| F2 | setLangOverride 调用顺序错 (在 t() 调用之后) | 测试覆盖「activate 启动后 t() 已能读 override」 |
| F5 | onDidChangeConfiguration 监听器顺序冲突 | 现有 longWaitingThresholdSec 监听器在同一回调里并列处理,不动 |
| D1/D2 | i18n 对称性测试漏过 | symmetry test 是 hard gate,加 key 必过 |

## Follow-up Checks (task.py start 前)

- [ ] 确认 `.trellis/spec/i18n.md` 需追加一段「LangStore / lang toggle」描述 (Phase 3.3 spec update)
- [ ] 确认 README 不需要更新 (新增功能对老用户透明)
- [ ] 确认 commit message 模板: `feat(i18n): add status bar language toggle (auto/zh/en)`
