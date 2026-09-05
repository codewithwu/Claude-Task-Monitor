# 更新日志 (Changelog)

本项目所有重要变更均记录于此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本 (SemVer)](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.3.7] - 2026-09-05

### Added

- **Uninstall 钩子与 `deactivate()` 解耦**（commit `fcc4b1f`，task `09-05-deactivate-uninstall-dialog`）:
  `deactivate()` 会在 reload / 窗口关闭 / 扩展禁用 / 卸载时全部触发,把"移除 hook?"对话框塞到这些路径上既吵又容易误点,而且真正卸载时 `void .then()` 还经常被 VS Code 提前截断。新增 `src/uninstall.ts`（纯 fs、无 vscode import）,
  `package.json` 增加 `vscode:uninstall` 生命周期钩子指向 `node ./dist/uninstall.js`,
  `deactivate()` 只剩资源释放。`installer.ts` 导出 `HOOK_SCRIPT_REL` /
  `CLAUDE_SETTINGS_REL` 让 uninstall 复用唯一真源;tsup 新增 `uninstall` 入口
  （3.5KB）。新增 6 个单元测试覆盖混合 hook 状态、缺失文件、幂等回写、hook.sh
  删除、完整 7 事件清理、损坏 JSON 兜底。closes improvement-backlog #2 (P0)。

### Fixed

- **macOS 上 PID 捕获失败导致 session 消失**（commit `009be26`，task `09-05-macos-session-disappear`）:
  `resources/hook.sh` 的 PID 上溯循环只走 `/proc/<pid>/comm`,macOS 没有
  /proc,`cat` 直接失败,`claude_pid` 留空。`effective_pid` 回落到 transient
  `PPID`(每个 hook event 都新生的 node MainThread / sh 子壳),5 秒后
  `pruneDeadSessions` 判定它已死,session 在每次事件后 ~2 秒就从侧边栏消失。
  抽出 `get_comm()` / `get_ppid()`,Linux 保留零 fork 的 `/proc` 直读,
  macOS 走 POSIX `ps -o comm=,ppid= ` + `tr -d ' '` 去掉 macOS ps 的尾部
  空白。while 循环体不动,只把查表原语变成平台感知。新增 3 个单元测试
  （bash -n 语法校验、Linux source-out 烟雾测试、静态断言 Darwin 分支存在）。
  `spec/liveness.md` 新增"PID capture lives in hook.sh, not here"段落防止
  后续 liveness 改动漂到错文件。closes improvement-backlog #1 (P0)。

## [0.3.6] - 2026-09-02

### Added

- **跨窗口通知去重 (leader election)**（`08-31-cross-window-notify-dedupe`）:
  开 N 个 VS Code 窗口时,同一 waiting 事件只弹 1 条 toast —— 取代原来每个窗口各弹一条的体验。
  基于 `~/.claude-task-monitor/notify-leader.lock` 的焦点感知选举:持锁者 = 最近聚焦的窗口,
  心跳过期或主动释放后接管。任何 fs 异常走 fail-open,绝不让所有窗口同时静默。
  配置 `claudeTaskMonitor.notifyLeaderElection` 控制开关（默认 `true`）。
  新增 `src/util/leaderLock.ts`（纯 fs,无 vscode import）+ `src/test/leaderLock.test.ts`
  （20 例,含真实 child process 多进程竞争「恰好 1 胜出」）。

## [0.3.5] - 2026-08-29

### Fixed

- **audit-r5: 3 core bugs**（commit `9ae6ae1`，round-5 5-agent 并行 src/ audit）:
  - **`formatError.ts:30` duck-typed `{message: ''}` 分支返回空串违反文件头契约**
    （`src/util/formatError.ts`）：文件头注释明确写"每一段都保证 t() 拿到非空字符串"，
    但 `typeof e === 'object' && e.message === 'string'` 这条路径在 `e.message === ''`
    时返回 `''`。镜像 `Error` 分支的 `|| String(e)` 兜底——空 message 落到
    `String({message: ''}) === '[object Object]'`，既非空也携带可读线索。
    新增 `formatError.test.ts` 用例 `[{message: ''} → '[object Object]']`。
  - **`watcher.ts:77` JSONL truncation 没重置 offsets map 导致下次仍早退**
    （`src/watcher.ts`）：`stat.size < offset`（truncate、fsync rollback 等）路径只
    early-return 没更新 map entry，map 跨 change event 持久，truncate + append 后
    下次 `size === offset` 仍命中早退分支，新内容永远读不到。改成同时重置 local
    `offset` 和 `offsets.set(file, 0)`，下次 change event 把 `[0..stat.size]` 完整
    重新读。新增 `watcher.test.ts` 用例 `truncateSync+append`。
  - **`treeDataProvider.ts:102` buildTooltip 用 `appendMarkdown` 渲染非受信用户输入**
    （`src/ui/treeDataProvider.ts`）：`MarkdownString.appendMarkdown` 不转义 markdown
    语法，钩子 payload 里 `[Click](https://evil)` 直接渲染成可点链接注入到 sidebar
    tooltip。**`lastUserPrompt` / `currentTool.input` 切换到 `MarkdownString.appendText`**
    （literal chars，不解析 markdown）。受控字符串（`basename` / `statusLabel` /
    `sessionId` / cwd code block）继续走 `appendMarkdown`。新增
    `treeDataProvider.test.ts`，用 `vi.mock'd MarkdownString` spy
    `appendText` vs `appendMarkdown` 调用次数。
- **i18n: 3 hardcoded Chinese strings**（commit `ce29ef7`，round-5 audit）:
  - **`rowPresentation.ts:77` dyingAt 行描述前缀硬编码 `'已退出 · '`**
    （`src/ui/rowPresentation.ts`）：en 用户在 sidebar 看到中文。新增 `status.dying`
    i18n key（en: `'Exited'`、zh: `'已退出'`），现有 `rowPresentation.test.ts`
    `dyingAt 有值` 用例继续在 zh-cn mock 下 pass。
  - **`extension.ts:482` `deactivate()` uninstall prompt + `'是/否'` 按钮硬编码中文**
    （`src/extension.ts`）：新增 `extension.uninstall.{prompt, remove, keep}` keys。
    **同步修 blocking-modal bug**：VS Code best practice 是 `deactivate()` 不能 await
    交互 UI，否则 extension host 关闭会卡住导致 uninstall cleanup 丢失。把
    `async/await` 改成 fire-and-forget `.then()`，UI 弹窗在后台异步处理，host
    关闭路径不阻塞。
  - **`extension.ts:97` activate-time jq-missing toast 硬编码中文**
    （`src/extension.ts`）：新增 `extension.jqMissing` key。shell 命令（brew / apt）
    不翻译——是命令标识符不是文案。
  - **Override note**：items 2、3 之前在 `08-23-fix-v020-leftovers` 中主动 deferred，
    本次按 round-5 priority list 显式 override。`i18n.test.ts` symmetry test
    （en ↔ zh key sets equal）继续 pass。

### Docs

- **spec: 落 round-5 audit 两条 pattern**（commit `a6cb01f`，无 src 改动）:
  - `.trellis/spec/ingest.md` — Watcher.readNew truncation recovery 契约：`stat.size < offset`
    时同时重置 local offset AND offsets map entry 到 0；只更新 local var 不够，
    map 跨 change event 持久，下次 append 仍 size===offset 早退。
  - `.trellis/spec/lifecycle.md` — MarkdownString.appendText vs appendMarkdown 边界：
    受控字符串（basename / statusLabel / sessionId）继续 appendMarkdown；非受信
    hook payload 字符串（`lastUserPrompt`、`currentTool.name`、`currentTool.input`）
    必须 appendText，不解析 markdown 语法，防止 link / image 注入。

### Testing

- `pnpm test`: 260/260 pass（round-5 自检，与 `9ae6ae1` / `ce29ef7` commit message
  声明一致）。
- `pnpm build`: green，`dist/extension.js` 生成成功。

## [0.3.4] - 2026-08-28

### Fixed

- **i18n lang pipeline round 4 加固，4 处 code-review 落实**（commit `0a3dc0c`）:
  - **`formatErrorMessage` 增加 duck-typed `{ message: string }` 分支**
    （`src/util/formatError.ts`）：受限 profile 下
    `workspace.getConfiguration().update()` 抛非 Error rejection
    （如 `{ message: 'Config is system-controlled' }`）时不再渲染成
    `[object Object]`。`instanceof Error` 优先判定保持，`String(e)` 兜底
    保持；只新增 `typeof e === 'object' && e !== null && typeof e.message === 'string'`
    中间分支返回 `e.message`，跟 `langStore.test.ts` 等老测试期望对齐。
  - **`LangToggle` 构造器改 fail-soft**（`src/ui/langToggle.ts`）：LangStore
    一次数据边界回归不应让整个 extension 关掉。非法 pref 不再 throw，
    改为 `console.warn` 一次 + 按钮降级显示 `$(globe) ?` + invalid
    tooltip（重新启用 `lang.toggle.invalid` i18n key，分别 zh/en 翻译：
    `语言偏好无效: {0}(等待下次同步自愈)` /
    `Invalid language preference: {0} (will self-heal on next sync)`），
    等待下次 `onDidChangeConfiguration` sync 自然自愈。
  - **`i18n.test.ts` 抑制 LangStore 构造器 warn 泄漏**
    （`src/test/i18n.test.ts`）：activation 测试构造 `LangStore('fr', ...)`
    时缺 `vi.spyOn(console, 'warn').mockImplementation(() => {})`，
    `console.warn('[claude-task-monitor] LangStore: invalid pref "fr"...')`
    漏到 vitest stderr。补 spy + `mockRestore()`，复刻
    `langStore.test.ts:160-186` 的标准范式。
  - **`extension.deactivate()` catch 走 `formatErrorMessage`**
    （`src/extension.ts:495-497`）：之前是 extension.ts 唯一一条没走
    helper 的 catch，违反 `formatError.ts` 文件头注释里
    "all catches covered" 的承诺。改 `console.warn('[claude-task-monitor]
    uninstall failed:', formatErrorMessage(e))`，grep `catch (` +
    `console.warn` 验证全 extension.ts 覆盖 100%。

### Testing

- `pnpm test`: 254/254 pass（+1 self-heal：formatError duck-typed case 把
  原期望 `[object Object]` 更新为 `'string-coerced'`）。
- `pnpm build`: green，`dist/extension.js` 239.54 KB。

## [0.3.3] - 2026-08-27

### Fixed

- **i18n lang pipeline round 2 加固，7 处 code-review 落实**（commit `4f86ab6`）:
  - **toast 渲染新增 `formatToggleFailMessage` 辅助 + 双分支 `String()` 兜底**
    （`src/extension.ts` + `src/util/formatError.ts`）：`(e as Error).message` 在
    `Error.message === null/undefined` 时返回字面量 `null`/`undefined`，直接套进
    `i18n.format(key, undefined)` 会漏出 `{0}` 占位符。两处 `instanceof Error`
    分支都补 `String(e)` 兜底；非 Error 对象（含 Promise rejection 等）走
    `String(e)`，不再依赖 `as Error` 的危险断言。
  - **`detectLang` / `detectEnvLang` 共享 `fromEnv()` 私有 helper**
    （`src/i18n/index.ts`）：env-language 解析（`vscode.env.language` startsWith
    `'zh'`）从两个公开函数里抽出来，以后加 ja/ko 等只改一处。
  - **activation path 切到 listener 写法**（`src/extension.ts`）：
    `setLangOverride(auto ? undefined : pref)` 与 `onDidChangeConfiguration`
    listener 保持一致；`pref='auto'` 路径下 override 一律是 `undefined`，不再有
    `i18n.detectLang()` 旁路污染。
  - **删除 `ui/langToggle.ts` 不可达防御分支**：`getPref: () => LangPref`
    已经收窄到 `LangPref` 类型，`LangStore` 是数据边界，把 `if (!pref)` 的
    fallback 移到构造器 throw，单一事实源。
  - **删除 `lang.toggle.invalid` i18n key**（`src/i18n/messages/{en,zh}.ts`）：
    round 2 把非法 pref 兜底上移到 LangStore 构造器 + `isLangPref()`，用户态
    `safePref()` 已移除，message key 跟着下线。
  - **修正 spec ownership 段落**（`.trellis/spec/i18n.md`）：override 实际由
    `extension.ts` 的 config listener 写入，不是 `LangStore`——这样 LangStore
    才能在 unit test 里独立 mock，跟"listener 写、store 读"的契约对齐。
  - **替换脆弱的 `:20` 行号引用为 stable anchor**
    （`src/extension.ts`：`.trellis/spec/i18n.md#manual-language-override`）：
    spec 行号飘移后 comment 就指错地方。

### Testing

- 新增 `langToggle.test.ts` (8 cases)、`formatError.test.ts` (13 cases)、
  `i18n.test.ts` +2 (FR3 错误信息渲染)。

- **i18n lang pipeline round 3 加固，10 处 code-review 落实**（commit `534a35f`）:
  - **activation path 改读 `langStore.get()` 而不是 raw `langPref`**
    （`src/extension.ts:83`）：settings.json 手编辑成 enum 之外的 `"fr"`
    在 activation 阶段被 `isLangPref()` 归一化到 `'auto'`，
    `setLangOverride` 不再被非法 cfg 污染。
  - **`formatToggleFailMessage` → `formatErrorMessage` 重命名**
    （`src/util/formatError.ts`）：这个 helper 是 generic error formatter
    而非 toggle 专属，名字收紧职责。
  - **8 处 `(e as Error).message` → `formatErrorMessage()` 重写**
    （`src/extension.ts` 5 处、`src/util/muted.ts` 2 处、
    `src/watcher.ts:93`）：原本的 `as Error` 在 non-Error rejection 上抛
    `TypeError`；现在统一走 helper 的 `instanceof + String()` 双分支兜底。
  - **`new Error()` 不再渲染成空 body**：之前用 `??`，
    `e.message === ''` 时回退到 `''`，最终 toast 是 `'Failed to switch UI
    language: '`（尾随冒号 + 空 body）。改 `||`，fallback 是 `'Error'`，
    至少给用户一个占位。
  - **spec listener 模式文档同步**（`.trellis/spec/i18n.md:27`）：从
    `langStore.currentLang()` 旧形式切到 `setLangOverride(undefined)`
    listener 写法，跟实际代码对齐。
  - **`langStore.ts:60` JSDoc 重写**：明确 `extension.ts` 的
    `onDidChangeConfiguration` 是 `setLangOverride` 的唯一写入者，
    LangStore 自身不写。
  - **修 broken spec reference**（`src/extension.ts:406`）：
    `.trellis/spec/i18n.md` 完整路径 + GitHub-flavored anchor slug
    `#manual-language-override-08-23-ui-lang-toggle`，不再裸 `:20`。
  - **`test/langToggle.test.ts` 收紧**：删除 dead `createSpy` 变量；
    加 zh-render case（mock `vscode.env.language='zh'`）让过宽的
    `/English|中文/` regex 不再 vacuous pass。
  - **`test/i18n.test.ts:213` comment 修正**：`extension.ts:83`
    （漂移前 `:80`）。
  - **POSIX trailing newline** 加到 `test/i18n.test.ts`。

### Testing

- `test/formatError.test.ts` 重命名为 `formatErrorMessage`，更新
  `new Error()` 期望从 `''` 到 `'Error'`，新增 regression case。
- 253/253 unit tests pass（+3：FR1 invalid cfg, FR3 empty-message,
  FR8 Chinese render）。
- 9/9 grep gates pass；typecheck 仅有 pre-existing errors，与本批无关。

## [0.3.2] - 2026-08-25

### Fixed

- **i18n lang pipeline 5 处 code-review 加固**（commit `793bcfe`，08-23
  `ui-lang-toggle` review 后续）：
  - **`LangStore.currentLang()` 'auto' 不再被 module override 污染**
    （`src/util/langStore.ts`）：之前调 `i18n.detectLang()` 读 override，
    `auto → zh → en → auto` 循环回不到 env。新增 `detectEnvLang()`（env only，
    绕过 override）专供 `currentLang()` 的 'auto' 分支，让语义在数据层独立。
    `src/extension.ts` 的 config 监听器在 pref=`auto` 时显式
    `setLangOverride(undefined)`，与 `.trellis/spec/i18n.md:20` 对齐。
  - **`toggleLanguageCommand` catch 块 null-safe**（`src/extension.ts`）：
    `workspace.getConfiguration().update()` 可能 reject null/undefined，
    `(e as Error).message` 让错误处理本身抛 TypeError。改为
    `e instanceof Error ? e.message : String(e)`。
  - **`LangStore` 数据层加 `isLangPref()` 守卫**（`src/util/langStore.ts`）：
    构造器 + `syncFromConfig()` 收到非法 pref 回落到 `'auto'` +
    `console.warn`。`LangToggle.render()` 也改用 `isLangPref()`，删除本地
    `safePref()`，单一事实源（`PREF_ORDER`）。

### Testing

- 单元测试 227 passed（195 既有 + 32 新）。

## [0.3.1] - 2026-08-24

### Fixed

- **状态栏语言切换按钮 + i18n 模块的 7 处加固**（基于 `08-23 ui-lang-toggle`
  code review 结果）：
  - **jq 缺失 banner 切语言后跟随刷新**（`src/extension.ts`）：之前 banner 只在
    激活时设一次，切语言后 sidebar 顶部警告停留在原 locale 直到 reload window。
    把 `applyJqBanner()` 加入 `onDidChangeConfiguration` 语言分支，跟其他 UI 一起刷。
  - **`toggleLanguageCommand` 不再吞错**（`src/extension.ts`）：
    `workspace.getConfiguration().update()` 在受限 profile / schema 校验失败时会 reject,
    之前 fire-and-forget 把 Promise 丢给 `registerCommand`,失败时用户看不到任何反馈。
    改为 async + try/catch,通过新增 `lang.toggle.fail` i18n key 弹错误 toast。
  - **`LangStore.set()` 写失败不再污染状态**（`src/util/langStore.ts`）：
    之前先改 `this.current` 再 `await config.update()`,update 抛错时 in-memory 跟
    config 永久偏离,下次 `cycle()` 会把用户的 `auto` 偏好静默覆盖成 `en`。赋值
    挪到 await 之后,失败时 `this.current` 保持原值,`syncFromConfig()` 自动对账。
  - **非法 pref 渲染字面量 "undefined" 的兜底**（`src/ui/langToggle.ts`）：
    settings.json 手编辑成 enum 之外的值（`"language": "fr"`,绕过 package.json
    enum）时 `LABELS[pref]` 返回 undefined,status bar 显示 `$(globe) undefined`,
    tooltip 漏出原始 i18n key。新增 `safePref()` 守卫 + `lang.toggle.invalid` tooltip,
    显示 `?` 并提示用户点击自愈（cycle() 会自然落到 `PREF_ORDER[0]='auto'`）。
  - **`LangStore.currentLang()` 委托给 `i18n.detectLang()`**（`src/util/langStore.ts`）：
    消除 `startsWith('zh')` 检测逻辑的双处维护。以后加 ja/ko 只改一处。
  - **`LangToggle` 构造函数收窄回 getter**（`src/ui/langToggle.ts`）：commit 661d891
    把它从 `() => LangPref` getter 改成完整 `LangStore` 实例,实际上 `render()` 只调
    `.get()`。恢复窄接口,跟 LangStore 的写方法（set/cycle/syncFromConfig）解耦。
  - **i18n 测试 override block 还原 `env.language`**（`src/test/i18n.test.ts`）：
    4 个 override test 把 `vscode.env.language` 留在不确定状态,只清 `setLangOverride`
    不还原 env,会污染后续测试。补 `originalLang` 捕获 + 还原,跟第一个 describe
    块对齐。

### Testing

- 单元测试总数保持 204（未新增用例,但 `i18n.test.ts` 的 override block 现在测试
  间状态隔离正确,不再有顺序敏感 flaky 风险）

[Unreleased]: https://github.com/codewithwu/Claude-Task-Monitor/compare/v0.3.4...HEAD
[0.3.4]: https://github.com/codewithwu/Claude-Task-Monitor/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/codewithwu/Claude-Task-Monitor/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/codewithwu/Claude-Task-Monitor/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/codewithwu/Claude-Task-Monitor/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/codewithwu/Claude-Task-Monitor/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/codewithwu/Claude-Task-Monitor/compare/v0.2.0...v0.2.1

## [0.3.0] - 2026-08-23

### Added

- **status bar 语言切换按钮 (auto / 中文 / English)** (`src/ui/langToggle.ts`,
  `src/util/langStore.ts`，`package.json`)：右下角紧邻 `CTM pulse` 的位置多出一个
  `$(globe) 🌐` 按钮，点击在三态间循环 (`auto` → `zh` → `en` → `auto`)。
  - `LangStore` 管理偏好（`Global` scope workspaceState）+ 配置写入 +
    三态切换逻辑，启动时回放上次选择
  - `LangToggle` 独立的 StatusBarItem (`priority 99`)，与 CTM pulse 视觉相邻
  - i18n 模块新增 `setLangOverride()` / `getLangOverride()` 模块级 hook，
    `detectLang()` 优先返回 override 值；`auto` 模式仍跟随 VS Code display language
  - 切换时全 UI 立即重画：`onDidChangeConfiguration` 监听器扩展触发
    `statusBar.update` / `applyBadge` / `treeDataProvider.refresh()`
- **配置项 `claudeTaskMonitor.language`** (`enum: auto | zh | en`, 默认 `auto`)
- **命令 `claudeTaskMonitor.toggleLanguage`**（Command Palette 可调，与按钮同效果）
- **i18n key `lang.toggle.state.{auto,zh,en}` + `lang.toggle.tooltip`** ——
  en / zh-cn 双语对称（tooltip 显式告知 "Command Palette / 视图标题仍由 VS Code
  display language 决定"）

### Testing

- 新增 14 个 `LangStore` 单测（三态切换 / 持久化 / 监听器 / 边界）
- 新增 4 个 i18n override 单测（auto/zh/en 三态 → 模块级 override → `detectLang`）
- 单元测试总数：186 → 204（+18 用例）

## [0.2.1] - 2026-08-23

### Fixed

- **i18n 收尾 —— 7 处硬编码中文 UI 文案遗漏**（影响英语用户）：
  - 通知 action 按钮 `打开项目` / `查看侧边栏` 改为 i18n key
    `notify.action.{openProject,viewSidebar}`（key 自 v0.2.0 定义但从未被引用）
  - Sidebar badge tooltip `${waiting} 个会话正在等待权限确认` →
    `t('badge.tooltip.one/many')`
  - 侧边栏每行 description 中 `等待权限` / `运行中` / `待命` → `t('status.label.*')`，
    新增 3 个 i18n key 双向对齐
  - `viewsWelcome.contents` 改为 `%welcome.content%` 占位符 + `package.nls` 双语翻译
  - `command.togglePin.title` zh-cn 翻译补完：`切换置顶 (Pin` →
    `切换置顶 (置顶 / 取消)`，与 `切换通知 (静音 / 恢复)` 同一 pattern
  - `banner.jqMissing` en 模板多余 `[`：`Copy [ command` → `Copy command`，跟中文对齐

### Changed

- `longWaitingThresholdSec` 配置支持热更新：去掉 `treeDataProvider.longWaitThresholdSec`
  的 `readonly`，新增 `setLongWaitThreshold(sec)` setter；
  `extension.ts` 注册 `workspace.onDidChangeConfiguration` 监听器。
  改设置后 sidebar waiting 行立即用新阈值，**无需 reload window**
- 聚合通知 "等 N 个" 数字现在正确：之前 5 个 waiting 时显示
  `5 个会话正在等待: a, b, c 等 5 个`（N 用总数，看起来像 "5 and 5 more" 的废话）。
  改为 `等 2 个`（N = 实际被截断数 = 5 - 3）。同一 bug 在 `formatWaitingTooltip` 一并修复
- 合并 `extension.ts:67-68` 的 dead `currentFilter` 中间变量（4 行 → 1 行，行为不变）

### Testing

- 新增 i18n key 对称性测试：`Object.keys(en).sort() === Object.keys(zh).sort()`，
  防止后续任务单边加 key 制造同类 bug
- 单元测试总数：185 → 186（+1 用例）

## [0.2.0] - 2026-08-23

### Added

- **单击 Session 在新窗口打开** (`forceNewWindow: true`)：之前点击替换当前
  workspace，多任务并行丢失上下文
- **Onboarding 可随时重入**：卸载钩子后 Welcome View 自动出现，引导重新安装；
  `showOnboarding` 命令随时调出引导卡片；引导文案跟随 locale
- **jq 缺失 banner**：检测到 `jq` 未装，视图顶部显示安装命令（brew / apt / winget），
  点击**复制**按钮一键粘贴到终端
- **色盲友好状态图标形状**：形状 + 颜色双重编码，灰度截图也能区分状态
  | 状态 | 旧 | 新 |
  |---|---|---|
  | Running | `circle-filled` 蓝 | `sync~spin` 旋转 + 蓝 |
  | Waiting | `circle-filled` 黄 | `circle-outline` 黄 + ⚠ |
  | Waiting ≥ 阈值 | 同上 | `alert` 红色 ⚠ |
- **通知模式 `claudeTaskMonitor.notifyMode`** (`silent` / `single` / `aggregate` /
  `legacy`，默认 `single`)；同时修复 dedupe key `sessionId` → `(sessionId, toolName)`，
  每个工具都正确收到通知
- **长等阈值配置 `claudeTaskMonitor.longWaitingThresholdSec`**（默认 300s）
- **快捷键**：`Shift+Cmd+C`（macOS）/ `Shift+Ctrl+C`（Win/Linux）聚焦 Session 视图
- **右键菜单 6 项 + Command Palette 9 项命令**：`Open in New/Current Window` /
  `View Session File` / `Copy Session ID` / `Toggle Pin` / `Toggle Mute` 等
- **Session 分组与过滤**：默认按状态分组（Running / Waiting / Idle / Dying），
  `defaultFilter` 配置 + `setFilter` 命令在状态栏切换，Pinned Session 始终排第一
- **配置入口与 Welcome 重构**：4 个新配置项分类进命令面板，Welcome View 一键安装 hook
- **Liveness 视觉反馈**：进程退出后显示 `⚠ 已退出 · 正在验证`（2 秒延迟），
  确认真的死后才归档，避免"诈尸"场景下的视觉跳变
- **中英双语 i18n**：所有动态 UI 文案走 `src/i18n/` 模块，自动检测
  `vscode.env.language`，`package.nls.json`（en）+ `package.nls.zh-cn.json`（zh-cn）双轨
- 状态栏 tooltip 显示前 3 个 waiting session 的项目名 + 等待时长

### Changed

- 升级 `engines.vscode` 至 `^1.86.0`（`TreeView<T>.badge` API 需要 1.86+）
- 构建配置升级 `node16` 模块解析（消除 TS 7.0 计划的 deprecation 警告）

### Testing

- 新增 43 个单测（事件 reducer、SessionStore 分组、installer、watcher 等核心模块）
- 单元测试总数：142 → 185

## [0.1.9] - 2026-08-16

### Changed

- **扩展 description 更新**（`package.json`）：从「Real-time dashboard」
  改为带「设计初心」hook 的版本，突出「红点 = 有会话在等你授权」的核心价值。
  Open VSX / Marketplace 搜索结果会显示新描述。

## [0.1.8] - 2026-08-16

### Added

- **sidebar 右键菜单**（5 个 action）(`src/extension.ts`, `package.json`)：
  - 复制 Session ID
  - 复制为 JSON（便于贴 issue 反馈）
  - 在集成终端打开（cwd 正确）
  - 在文件管理器显示
  - 立即归档（强制 SessionEnd）

## [0.1.7] - 2026-08-16

### Changed (内部清理，无用户可见行为变化)

- **`SessionStore.offChange(fn)`** (`src/stateManager.ts`)：新增取消订阅接口，
  `SessionTreeDataProvider` 暴露 `dispose()` 并在 `context.subscriptions` 里
  注册，激活/卸载时释放 EventEmitter + listener。
- **`statusBar.update` / `applyBadge` 联合去重** (`src/extension.ts`)：
  之前 `store.onChange` 每次事件（UserPromptSubmit、PreToolUse、PostToolUse
  等）都重算 badge + status bar —— 但 waiting 集合没变就是浪费。新增
  `syncWaitingDependentUI()` 用闭包变量跟踪 `lastWaitingCount`，count
  不变则跳过两个 UI 更新；tick 不再触发 `statusBar.update`。
- **`installHookAssets` 内容幂等写** (`src/extension.ts`)：序列化后的
  `settings.json` 与原内容相等则跳过 `writeFileSync`，避免每次激活都
  touch `~/.claude/settings.json` 的 mtime。
- **`notifyMessage` 移除未接入的 `displayName` 形参**：之前是预留 hook，
  仅测试用过；接入场景未发生，先删掉避免误用。

## [0.1.6] - 2026-08-16

### Fixed

- **未装 jq 的用户不再被「hook 已安装」误导** (`src/extension.ts`,
  `src/ui/onboarding.ts`)：`detectJq()` 返回 false 时**跳过**自动
  `installHookAssets`，避免写入依赖 jq 的 hook.sh 后静默失败。同时把
  onboarding 的「复制 brew/apt 命令」按钮从 `'install'` 路径改回 `'copy'`，
  不再触发误导性的「hook 已安装」toast；只复制命令让用户自己去终端跑。
- **Windows 路径的 `Edit` / `Write` 行 label** (`src/util/toolSummary.ts`,
  `src/util/notifyMessage.ts`)：之前本地 `basename()` 只 split `/`，原生
  Windows Claude Code 发的 `C:\Users\me\src\auth.ts` 会整段塞进 label
  撑爆 60 字符预算。改用 `path.posix.basename(p.replace(/\\/g, '/'))`，
  POSIX 和 Windows 路径都正确。
- **`renderRowPresentation` 的死参数** (`src/util/rowPresentation.ts`)：
  删掉 `nowSec` 形参和函数内部对 `Date.now()` 的重算 —— 信任 caller 传入
  的 `elapsedSec`（与 `treeDataProvider` tooltip 共用同一份计算），避免
  双源时间漂移。

## [0.1.5] - 2026-08-16

### Added

- **waiting 行余光可读「等什么 + 等多久」** (`src/util/rowPresentation.ts`,
  `src/util/toolSummary.ts`)：sidebar waiting 行的 description 现在插入
  `tool_name`，label 拼接 `toolSummary`（如 `git push --force · my-project`）。
  Bash 命令 / Edit 文件路径 / WebFetch URL 自动归一化到人类可读短串，长命令
  截断到 60 字符。waiting 持续 ≥ 5 分钟时，icon 从 `circle-filled` 升级为
  `alert` + 主题色换 `errorForeground`，视觉拉满。
- **首次激活 onboarding** (`src/ui/onboarding.ts`)：扩展首次激活用
  `globalState.ctm.onboardingShown`（MachineScope）做幂等标记，弹一次三步
  引导卡片（安装 hook → 启动 claude → 看红点），含「安装 hook」/「跳过」
  按钮。`jq` 缺失分支自动改文案为引导装 jq，附「复制 brew/apt 命令」按钮。
- **status bar 实时 waiting 数** (`src/ui/statusBar.ts`,
  `src/util/statusBarContent.ts`)：右下角常驻 `$(pulse) CTM`，waiting ≥ 1
  时变为 `$(pulse) CTM: W⚠`。点击 reveal sessionsView。sidebar 折叠时也不
  丢存在感。
- **通知聚合** (`src/notifier.ts`, `src/util/notifyMessage.ts`)：多会话并行
  时不再刷屏 —— N=1 沿用旧单条体感，N≥2 合并成一条 `N 个会话正在等待：
  name1, name2, ... 等 N 个`。新增配置 `claudeTaskMonitor.notifyAggregateMode`
  (`perSession` / `aggregate`，默认 `aggregate`)。
- **sidebar 图标徽标** (`src/ui/badge.ts`)：waiting ≥ 1 时图标右上角显示
  数字徽标，离开屏幕回来也能秒看到还有几个会话在等。

### Changed

- **engines.vscode 升级到 `^1.86.0`**：`TreeView<T>.badge` API 需要 VS Code
  1.86+。锁在 1.85 的用户升级到此版本会被 VS Code 拒绝安装；VS Code 1.86
  已发布 18 个月，基线用户应都已升级。

## [0.1.4] - 2026-08-16

### Changed

- **构建配置升级到 `node16` 模块解析**：`tsconfig.json` 把 `module` /
  `moduleResolution` 从已弃用的 `node` (node10) 升级到 `node16`，消除
  TS 7.0 计划移除的 deprecation 警告。`src/` 下所有相对 import 加上 `.js`
  扩展名以符合 Node.js 16+ 解析规则。运行时行为不变（`package.json` 无
  `"type": "module"`，输出仍为 CJS，`tsup` 配置未变）。

## [0.1.3] - 2026-08-16

### Fixed

- **被 `strace` / `gdb` 附着的 Claude CLI 永远不被判定为已死**：`liveness.ts`
  `checkViaProc` 之前的正则 `\w+` 抓不到多词状态名 `t (tracing stop)`，且常量
  `'tracing_stop'`（下划线）与内核实际输出 `'tracing stop'`（空格）对不上；
  `checkViaPsFallback` / `checkViaWslOrTasklist` 的大小写敏感比较漏掉了
  `ps -o stat=` 对 ptrace'd 进程返回的小写 `t`。综合结果：任何被 `strace` /
  `gdb` 附着的 CLI 在 Linux / macOS / WSL2 三平台都无法被检测为 gone，违反
  spec 里"kill 用户无法交互的进程"的不变量。现在三个平台分支统一判定
  `c === 'T' || c === 't' || c === 'Z' || c === 'X'`（`T` 为 SIGSTOP，
  `t` 为 ptrace tracing-stop，二者 case 不同）。
- **`Notifier.lastNotifiedAt` Map 永久泄漏**：commit `c5266a8` 删除了
  `Notifier.reset(sessionId)`（"删除无调用方的 Notifier.reset"），但未在
  `store.removeByPid` 或 `store.apply` 的 SessionEnd 分支补回清理调用，
  导致 dedup 记录按总 session 数线性增长。重新引入 `Notifier.reset`，
  `SessionStore` 通过构造函数注入 `onSessionRemoved` 回调，在 SessionEnd
  和 `removeByPid` 时调用（未知 session 仍走 prev === null 短路，保持
  chokidar-unlink race 处理语义）。

### Docs

- `.trellis/spec/liveness.md` 重写：把 cross-platform process state code
  alphabet（R/S/D/I/T/t/Z/X）提到首位作为真理表，所有平台分支引用同一张表。
- 新增 "Notifier ↔ SessionStore Cleanup Wiring" 章节，记录 `Notifier.reset`
  的结构性角色（防止下次再有人因"无 caller"就删）。
- 新增 "Post-mortem: prevention checklist"，列出 6 项下次改 `liveness.ts` /
  `notifier.ts` 之前的必跑项（含 delete-API structural grep）。
- 顺带修 `.trellis/spec/testing.md:56` 的 `'tracing_stop'`（下划线，从未匹
  配任何东西）→ `'tracing stop'`（实际内核输出）。

### Testing

- 新增 12 个 vitest 用例：小写 `t`（win32 wsl.exe、darwin ps、linux `/proc`
  fallback）、多词状态名 `t (tracing stop)`（mocked `fs.readFileSync` + 
  `process.pid` 绕过 ESRCH 短路）、`Notifier.reset` 语义、SessionStore
  `onSessionRemoved` 触发规则（hit / miss / 未知 session / 向后兼容）。
- 单元测试总数：84 → 95。

[Unreleased]: https://github.com/codewithwu/Claude-Task-Monitor/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/codewithwu/Claude-Task-Monitor/compare/v0.1.2...v0.1.3

## [0.1.2] - 2026-08-16

### Fixed

- **WSL2 会话被误判为已死**：之前在 Windows 上跑扩展时，`process.kill(wslPid, 0)` 会抛
  `ESRCH`（Windows 进程表查不到 Linux PID），导致 5s 内所有 WSL2 内的 Claude 会话被全部
  误清空。现改为平台路由：Linux/WSL guest 走 `/proc/${pid}/status`，macOS 走 `ps`，Windows
  优先 `wsl.exe ps` 查 WSL2 PID，失败再降级到 `tasklist`。
- **纯 Windows 上死会话永远清不掉**：`/proc` 不存在、`ps` 又不在 PATH 时 catch 块返回
  `false`，导致 Ctrl+Z / 异常退出的 CLI 永久挂在侧边栏。`tasklist` 路径修复后正确识别。
- **prune 与 chokidar 抢同一会话的双重刷新**：`pruneDeadSessions` 归档后 `removeByPid` 触发
  一次 emit，几毫秒后 chokidar 的异步 `unlink` 事件派发合成 `SessionEnd` 又 emit 一次，
  N 个会话同时死时是一次 UI 重绘风暴。`apply` 现在对未知/已移除 session 的 SessionEnd
  和 reduce 返回 prev 引用本身（no-op）的 update 不再 emit。
- **`execSync` 字符串拼接注入风险**：`ps -o stat= -p ${pid}` 改为 `execFileSync('ps', [...])`
  走数组参数，畸形 PID 不再被 shell 解释。
- **归档文件名同秒撞名**：`hook.sh` 路径用 `$(date +%s)`、TS 路径用 `Date.now()`，同秒内
  多次归档会互相覆盖。两边都加了唯一后缀（hook.sh 用 `$$`，TS 用 `randomUUID` 切片）。
- **prune 循环里 `mkdirSync` 反复 stat**：N 个死会话对应 N 次 mkdir 系统调用。提到循环外。
- **激活时泄漏 session ID 前缀到 DevTools Console**：删掉两行 `console.log`。

### Changed

- 删除无调用方的 `Notifier.reset` 方法（死代码）。

### Testing

- 新增 platform-routing 单元测试（win32 优先 `wsl.exe` 再 `tasklist`、两者都失败时不误杀）
- 新增非整数 PID（NaN / 0 / 负数 / 小数）健壮性测试
- 新增 `apply` no-op 不 emit 的 6 条断言
- 新增 `pruneDeadSessions` 幂等性测试
- 新增 `hook.sh` SessionEnd 归档文件名包含 PID 后缀的断言
- 单元测试总数：75 → 84

[0.1.3]: https://github.com/codewithwu/Claude-Task-Monitor/releases/tag/v0.1.3
[0.1.2]: https://github.com/codewithwu/Claude-Task-Monitor/releases/tag/v0.1.2
[0.1.1]: https://github.com/codewithwu/Claude-Task-Monitor/releases/tag/v0.1.1
[0.1.0]: https://github.com/codewithwu/Claude-Task-Monitor/releases/tag/v0.1.0

### Fixed

- 替换扩展图标：从空 PNG 改为基于 `sidebar.svg` 渲染的 428×428 dashboard 图标（5 根柱状图）

## [0.1.0] - 2026-06-08

首个公开版本。提供 Claude Code CLI 会话的本地实时监控。

### Added

- 活动栏侧边栏：实时显示所有本地 Claude Code CLI 会话及三态徽标
  - 🟢 待命 (idle)
  - 🟡 运行中 (running)
  - 🔴 等待人工确认 (waiting)
- 🔴 状态时弹出 VS Code 通知，点击通知或侧边栏条目可跳转到对应项目
- 会话持续时间滚动显示（`30s` → `1m` → `2m`...）
- 智能排序：🔴 永远置顶，同色按状态变更时间倒序
- Hook 机制：扩展首次激活时自动将 `~/.claude-task-monitor/hook.sh` 与
  `~/.claude/settings.json` 中的 hooks 块合并，对用户已有 hooks 保持幂等
- 会话活性检测：通过 PID 活性检查把 `kill -9`、SIGSTOP、僵尸等异常退出的
  CLI 从侧边栏移除，并把对应 `.jsonl` 归档到 `~/.claude-task-monitor/sessions/.ended/`
- 配置项（VS Code Settings）：
  - `claudeTaskMonitor.staleHours`（默认 24）：文件 mtime 超过该小时数视为僵尸
  - `claudeTaskMonitor.notifyDedupeSeconds`（默认 30）：同 session 通知去重窗口
  - `claudeTaskMonitor.refreshIntervalMs`（默认 1000）：侧边栏持续时间刷新间隔
  - `claudeTaskMonitor.livenessCheckIntervalMs`（默认 5000）：进程活性检测间隔
- 卸载时弹确认对话框，可同时移除注入的 `hook.sh` 与 `settings.json` 条目
- 自定义侧边栏图标与扩展图标

### Fixed

- Hook 启动时沿进程树向上查找 comm 为 `claude` 的 durable PID，避免被
  `PPID` 的瞬时值误导
- 首次添加会话时保留 watcher offset，避免重复读取已处理过的 JSONL 行
- 集成测试中 `ours` 类型在 `tsc --noEmit` 下过宽，缩窄类型
- 进程活性检测：识别 SIGSTOP 暂停与僵尸状态，prune 时归档 `.jsonl`

### Testing

- 集成测试：使用 `@vscode/test-electron` 启动真实 VS Code 实例
- 端到端活性检测：起真实子进程，覆盖 `kill -9` / SIGSTOP / 正常退出三种路径
- 单元测试：事件 reducer、SessionStore、installer、watcher 等核心模块
