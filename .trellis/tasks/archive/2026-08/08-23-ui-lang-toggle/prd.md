# UI 中英文切换按钮

## Goal

让用户能在不重启 VS Code、不改 display language 的情况下,在 status bar 点一个按钮临时在 **自动 / 中文 / English** 三态间循环,Claude Task Monitor 扩展的所有**动态 UI 文案**立即跟随切换。

直接场景(根据用户工作模式):
- 验证新翻译条目:刚加了几条 zh 文案,想立即看英文版对照 → 现在得改 display language 整个 VS Code 重启。
- 给英文 README 截图:用户正在写英文 README 想截 UI 图,需要把所有动态文案切到英文。
- 临时给英文同事演示:切到英文版给 ta 看。

## Background

### 当前 i18n 架构

- 自建轻量 i18n (`src/i18n/`),38 keys 对称(zh↔en),`t()` 每次调用重新走 `detectLang()`,运行时已经是 reactive 的。
- `detectLang()` (`src/i18n/index.ts:28-30`) 只读 `vscode.env.language`,**无手动覆盖入口**。
- UI 元素是事件驱动渲染,语言切换后需主动 broadcast 重绘事件。

### 包元数据硬限制

- `package.json` 的 `%key%` 占位符(Command Palette 命令标题、视图标题、`viewsWelcome.contents`)**在 VS Code 激活时一次性解析**,运行时改不了,需要 reload window 且还得改 VS Code display language。
- 因此本功能的**真实生效范围**只覆盖 `t()` 调用的动态文案:status bar 文字/tooltip、sidebar tree description、badge tooltip、notification/toast、onboarding cards、banner、quickPick 文案。
- Command Palette / 视图标题 / Welcome 内容**不在范围内**,通过按钮 tooltip 诚实告知用户限制。

## Requirements

### FR-1: Status Bar Toggle Button
- 在 status bar 显示一个独立 StatusBarItem,priority 99(紧邻现有 CTM item priority 100)。
- 文本:`$(globe) A` / `$(globe) 中` / `$(globe) EN`,分别对应 auto/zh/en 状态。
- tooltip(多行,i18n 化):
  ```
  UI language: <当前状态>
  Click to switch to <下一状态>
  Command palette names follow VS Code display language
  ```
- 点击触发命令 `claudeTaskMonitor.toggleLanguage`。

### FR-2: 3 状态循环
- 状态序列:auto → zh → en → auto → ...(无限循环)
- 每次点击后立即通过 config 设置写入持久化(`ConfigurationTarget.Global`,跨工作区)。

### FR-3: 配置项
- `package.json` 新增 `claudeTaskMonitor.language` 配置项,enum `["auto", "zh", "en"]`,默认 `"auto"`。
- 用户可在 Settings UI 直接编辑,无需经过按钮。
- `description` 用中文描述(沿用项目现有 8 个配置项的风格),说明本设置只影响动态文案。

### FR-4: 动态文案实时刷新
切换后立即刷新以下 UI 元素(无需 reload):
- StatusBar 文字 + tooltip (`src/ui/statusBar.ts`)
- Sidebar Tree 节点 description (`src/treeDataProvider.ts`)
- Sidebar activity bar badge tooltip (`src/ui/badge.ts`)
- 后续弹出的 notification、toast、quickPick 文案
- Toggle 按钮自身文字 + tooltip
- 现有 jq-missing banner 文案

### FR-5: i18n 模块改造
- `src/i18n/index.ts` 新增模块级 override 变量 + `setLangOverride()` export。
- `detectLang()` 优先返回 override,缺省时回落 `vscode.env.language`。
- 不改 `t()` 签名,所有现有调用点零改动。
- 新增 4 个 i18n key,对称加到 `en.ts` + `zh.ts`:
  - `lang.toggle.state.auto` / `.zh` / `.en` —— 三状态显示名
  - `lang.toggle.tooltip` —— tooltip 模板,含 `{0}` 当前名 + `{1}` 下一名

### NFR-1: 测试覆盖
- 新增 `src/test/langStore.test.ts`:8 个 case 覆盖 cycle/set/sync/initial。
- `src/test/i18n.test.ts` 新增 `detectLang` override 测试(afterEach 重置)。
- 现有 symmetry test 自动覆盖新 key 对称性。

### NFR-2: 范围严格性
- **不动** hook、watcher、state model、liveness、notifier。
- **不动** `deactivate()` 中的硬编码中文 toast(沿用 08-23-fix-v020-leftovers deferred 状态)。
- **不动** 5 处 `extension.ts` 内的硬编码中文 toast(同上)。
- **不新增** 第三方依赖。

## Technical Constraints

| 约束 | 来源 |
|---|---|
| Command Palette 标题运行时不可改 | VS Code 平台硬限制,`%key%` 激活时解析 |
| 测试用 `vi.mock('vscode', ...)` 模式 | 项目约定 (`src/test/*.test.ts`) |
| i18n 模块级 override 是可变全局 | 需在测试 afterEach 显式重置 |
| 配置 description 沿用中文风格 | 现有 8 个配置项都写中文 |
| 不引入第三方依赖 | vsce 打包 + 包体积 |

## Out of Scope

- 添加第三种语言 (ja / ko 等) — 无用户需求。
- 迁移到 `vscode.l10n` — 38 keys 不值得引入 XLF 工具链。
- Command Palette 命令标题 / 视图标题 / Welcome 内容 切换 — 平台硬限制。
- workspaceState 双层覆盖 — config-only,用户级已满足需求。
- 修改 `deactivate()` 硬编码 toast — 沿用 deferred 状态。

## Acceptance Criteria

### AC-1: Button 可见性 & 视觉
- [ ] 扩展激活后 status bar 出现 `$(globe) A` 项,priority 99,紧邻 CTM。
- [ ] tooltip 多行包含:当前状态名、下一状态名、Command palette 限制说明。
- [ ] 3 状态文本分别正确显示:`A` / `中` / `EN`。

### AC-2: Click 行为
- [ ] 点击 1 次:A → 中,所有动态 UI 立即变中文。
- [ ] 点击 2 次:中 → EN,所有动态 UI 立即变英文。
- [ ] 点击 3 次:EN → A,所有动态 UI 回退到 `vscode.env.language` 检测结果。
- [ ] 第 4 次:回到 中(循环)。

### AC-3: 持久化
- [ ] 点击切换后,关闭并重新打开 VS Code,按钮状态保留。
- [ ] 在 Settings UI 修改 `claudeTaskMonitor.language` 为 `zh`,按钮立即变 `中`。
- [ ] 跨工作区切换,偏好保留(Global scope)。

### AC-4: 动态 UI 重绘
- [ ] 切换后,StatusBar 文字 (CTM、waiting tooltip) 立即跟随。
- [ ] 切换后,Sidebar Tree 节点 description (waiting/running/idle) 立即跟随。
- [ ] 切换后,Badge tooltip (waiting 数量) 立即跟随。
- [ ] 切换后,新弹的 notification/toast 用新语言(已弹的不变)。

### AC-5: 诚实告知
- [ ] tooltip 第三行明确说"Command palette names follow VS Code display language"。
- [ ] 用户切到非 auto 态时,Command Palette 命令标题仍为原 locale 对应语言(不报错)。

### AC-6: 测试
- [ ] `pnpm test` 全部通过 (含 8 个 LangStore case + i18n override case + 现有 symmetry test)。
- [ ] `pnpm build` 编译通过。

## Confirmed Facts (代码佐证)

| 文件:行 | 事实 |
|---|---|
| `src/i18n/index.ts:38-55` | `t()` 每次调用重新解析 lang,无需修改函数本身 |
| `src/i18n/index.ts:28-30` | `detectLang()` 只看 `vscode.env.language` |
| `extension.ts:303-322` | refresh 路径:`store.onChange → syncWaitingDependentUI → statusBar.update + applyBadge` |
| `extension.ts:38-43` | `workspace.getConfiguration('claudeTaskMonitor')` 已有 8 个用户设置 |
| `extension.ts:355-360` | 现有 `onDidChangeConfiguration` 监听器模式可复用 |
| `src/ui/statusBar.ts:23-29` | 现有 StatusBarItem 在 Right + priority 100 |
| `.trellis/spec/i18n.md:108-120` | package.nls.json 走 `%key%`,运行时不可改 |
| `package.json` | `claudeTaskMonitor.notifyMode` 等都是 enum 设置,新 `language` 对齐 |

## Key Decisions (用户已确认)

| 决策点 | 选择 | 备选 |
|---|---|---|
| Trellis 任务流 | ✅ 走 Trellis + brainstorm | inline 实现 / PRD-only |
| 按钮位置 | ✅ status bar | sidebar 标题 / Command Palette / Setting |
| 状态数 | ✅ 3 态循环 (auto/zh/en) | 2 态循环 / quickPick |
| 持久化 | ✅ VS Code 配置项 (Global scope) | workspaceState / 双层 |
| Reload UX | ✅ 诚实告知,不 reload | 弹 reload prompt / auto-reload |
| 范围边界 | ✅ 只动动态 UI | 含 Command Palette (不可行) |

## Notes

- 隐含收益:用户改完 zh 翻译后能立即在 EN 视图验证对照,加快翻译 review 流程。
- 无需 README 更新(增量功能对老用户透明)。
- 不涉及 deprecation(无破坏性改动)。
- Phase 3.3 需更新 `.trellis/spec/i18n.md` 追加「LangStore / lang toggle」描述段。
