# Implement: v0.2.0 leftover fixes

## Pre-flight

```bash
# 1. 确认工作区干净
git status
# 期望: nothing to commit, working tree clean

# 2. 确认 main 分支
git branch --show-current   # main

# 3. 确认基线测试通过
pnpm test 2>&1 | tail -20
# 期望: 所有 185 tests pass

# 4. 确认基线 build 通过
pnpm build 2>&1 | tail -10
# 期望: 无 TS error, dist/ 生成
```

如果 #3 或 #4 失败,**先 stop**,不能基于 broken baseline 修。

## Commit A: i18n cleanup (findings 1, 2, 3, 5, 6, 7)

### A1. 新增 i18n key

文件:`src/i18n/messages/en.ts`

在 `// ─── status bar / sidebar 状态 ───` 区块(line 5-11)末尾追加:
```ts
// ─── sidebar badge tooltip ───
'badge.tooltip.one': '1 session waiting for permission',
'badge.tooltip.many': '{0} sessions waiting for permission',

// ─── row presentation status (sidebar row description) ───
'status.label.waiting': 'Waiting',
'status.label.running': 'Running',
'status.label.idle': 'Idle',
```

文件:`src/i18n/messages/zh.ts`

同样位置追加:
```ts
// ─── sidebar badge tooltip ───
'badge.tooltip.one': '1 个会话正在等待权限确认',
'badge.tooltip.many': '{0} 个会话正在等待权限确认',

// ─── row presentation status ───
'status.label.waiting': '等待权限',
'status.label.running': '运行中',
'status.label.idle': '待命',
```

**顺序约束**:en.ts 和 zh.ts 同步编辑,且添加的相对位置一致 (test 对称性检查 `Object.keys().sort()` 比对)。

### A2. 修复 banner.jqMissing 多余 `[`

文件:`src/i18n/messages/en.ts:31`

```ts
// 改前
'banner.jqMissing': '⚠️ Claude Task Monitor needs `jq` to work.\n\n[Copy [ command](command:claudeTaskMonitor.copyJqInstallCommand) · [Show onboarding](command:claudeTaskMonitor.showOnboarding)',

// 改后
'banner.jqMissing': '⚠️ Claude Task Monitor needs `jq` to work.\n\n[Copy command](command:claudeTaskMonitor.copyJqInstallCommand) · [Show onboarding](command:claudeTaskMonitor.showOnboarding)',
```

zh.ts:31 不动 (已是正确文案 `[复制安装命令](...)`)。

### A3. 修复 extension.ts 通知按钮硬编码

文件:`src/extension.ts:104-120`

```ts
// 改前 (line 106)
void vscode.window.showWarningMessage(msg, '打开项目').then(action => {
  if (action === '打开项目') {
    void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(s.cwd), { forceNewWindow: false })
  }
})

// 改后
const openProjectLabel = t('notify.action.openProject')
void vscode.window.showWarningMessage(msg, openProjectLabel).then(action => {
  if (action === openProjectLabel) {
    void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(s.cwd), { forceNewWindow: false })
  }
})

// 改前 (line 116)
void vscode.window.showWarningMessage(msg, '查看侧边栏').then(action => {
  if (action === '查看侧边栏') {
    void vscode.commands.executeCommand(FOCUS_SESSIONS_VIEW_COMMAND)
  }
})

// 改后
const viewSidebarLabel = t('notify.action.viewSidebar')
void vscode.window.showWarningMessage(msg, viewSidebarLabel).then(action => {
  if (action === viewSidebarLabel) {
    void vscode.commands.executeCommand(FOCUS_SESSIONS_VIEW_COMMAND)
  }
})
```

`t` 在 line 25 已 import,无需新增 import。

### A4. 修复 badge.ts tooltip 硬编码

文件:`src/ui/badge.ts`

```ts
// 改前
import * as vscode from 'vscode'
import type { SessionStore } from '../stateManager.js'

export function applyBadge(treeView: vscode.TreeView<unknown>, store: SessionStore): void {
  const waiting = store.list().filter(s => s.status === 'waiting').length
  treeView.badge = waiting > 0
    ? { value: waiting, tooltip: `${waiting} 个会话正在等待权限确认` }
    : undefined
}

// 改后
import * as vscode from 'vscode'
import type { SessionStore } from '../stateManager.js'
import { t } from '../i18n/index.js'

export function applyBadge(treeView: vscode.TreeView<unknown>, store: SessionStore): void {
  const waiting = store.list().filter(s => s.status === 'waiting').length
  treeView.badge = waiting > 0
    ? {
        value: waiting,
        tooltip: waiting === 1
          ? t('badge.tooltip.one')
          : t('badge.tooltip.many', waiting)
      }
    : undefined
}
```

### A5. 修复 rowPresentation.ts STATUS_LABEL 硬编码

文件:`src/util/rowPresentation.ts:13-32`

```ts
// 改前
import * as path from 'node:path'
import type { SessionState } from '../types.js'
import { humanizeDuration } from './time.js'
import { summarizeTool } from './toolSummary.js'

export interface RowPresentation {
  label: string
  description: string
  iconId: string
  iconColor: string
}

const STATUS_LABEL: Record<SessionState['status'], string> = {
  waiting: '等待权限',
  running: '运行中',
  idle:    '待命'
}

// tooltip 还要拼同一套状态文案,导出供 treeDataProvider 复用,避免双份
export const statusLabel = (status: SessionState['status']): string => STATUS_LABEL[status]

// 改后
import * as path from 'node:path'
import type { SessionState } from '../types.js'
import { humanizeDuration } from './time.js'
import { summarizeTool } from './toolSummary.js'
import { t } from '../i18n/index.js'

export interface RowPresentation {
  label: string
  description: string
  iconId: string
  iconColor: string
}

// 行 83 (description 拼接) 改为调用 statusLabel()
// STATUS_LABEL 删除,统一走 t()

// tooltip 还要拼同一套状态文案,导出供 treeDataProvider 复用,避免双份
export const statusLabel = (status: SessionState['status']): string =>
  t(`status.label.${status}` as const)
```

并把 line 83 的 `STATUS_LABEL[s.status]` 改为 `statusLabel(s.status)`。

注:`as const` 让 TS 推断 `'status.label.waiting' | 'status.label.running' | 'status.label.idle'`,编译期保证三个 key 都存在 (新增 key 时如拼错会立即报错)。

### A6. 修复 togglePin.title zh-cn 翻译

文件:`package.nls.zh-cn.json:16`

```json
// 改前
"command.togglePin.title": "切换置顶 (Pin",

// 改后
"command.togglePin.title": "切换置顶 (置顶 / 取消)",
```

(`package.nls.json:16` 英文 `"Toggle Pin (Top)"` 不动)

### A7. 修复 viewsWelcome 本地化

文件:`package.json:65`

```json
// 改前 (line 65)
"contents": "## 没有看到你的 Claude 会话?\n\n启动 `claude` 后会自动出现 —— sidebar 第一次刷新可能需要 1-2 秒。\n\n### 还没显示?试试这些:\n\n[安装 hook](command:claudeTaskMonitor.installHook) · [查看 onboarding](command:claudeTaskMonitor.showOnboarding)\n\n[设置](command:workbench.action.openSettings,[\"claudeTaskMonitor\"]) · [打开文档](command:claudeTaskMonitor.openDocs)\n\n> 提示:确认 `jq` 已安装 (macOS `brew install jq` / Debian-Ubuntu `apt install jq`)。缺失时 sidebar 顶部会有红色提示。"

// 改后
"contents": "%welcome.content%"
```

文件:`package.nls.json` — 在 `command.openDocs.title` (line 26) 之后追加:
```json
"welcome.content": "## Don't see your Claude sessions?\n\nStart `claude` in a terminal and they'll appear automatically — first sidebar refresh may take 1-2 seconds.\n\n### Still nothing? Try these:\n\n[Install hook](command:claudeTaskMonitor.installHook) · [Show onboarding](command:claudeTaskMonitor.showOnboarding)\n\n[Settings](command:workbench.action.openSettings,[\"claudeTaskMonitor\"]) · [Open documentation](command:claudeTaskMonitor.openDocs)\n\n> Tip: confirm `jq` is installed (macOS `brew install jq` / Debian-Ubuntu `apt install jq`). When missing, a red banner appears at the top of the sidebar."
```

文件:`package.nls.zh-cn.json` — 在 `command.openDocs.title` (line 27) 之后追加同样 key:
```json
"welcome.content": "## 没有看到你的 Claude 会话?\n\n启动 `claude` 后会自动出现 —— sidebar 第一次刷新可能需要 1-2 秒。\n\n### 还没显示?试试这些:\n\n[安装 hook](command:claudeTaskMonitor.installHook) · [查看 onboarding](command:claudeTaskMonitor.showOnboarding)\n\n[设置](command:workbench.action.openSettings,[\"claudeTaskMonitor\"]) · [打开文档](command:claudeTaskMonitor.openDocs)\n\n> 提示:确认 `jq` 已安装 (macOS `brew install jq` / Debian-Ubuntu `apt install jq`)。缺失时 sidebar 顶部会有红色提示。"
```

### A8. 更新测试

文件:`src/test/badge.test.ts:46`

```ts
// 改前 (line 1)
import { describe, it, expect } from 'vitest'
import * as vscode from 'vscode'
import { applyBadge } from '../ui/badge.js'
// ...
// 改后
import { describe, it, expect, vi } from 'vitest'
import * as vscode from 'vscode'
import { applyBadge } from '../ui/badge.js'

vi.mock('vscode', () => ({ env: { language: 'zh-cn' } }))
```

```ts
// 改前 (line 46)
expect(tv.badge?.tooltip).toBe('1 个会话正在等待权限确认')

// 改后
expect(tv.badge?.tooltip).toBe('1 个会话正在等待权限确认')  // i18n key 'badge.tooltip.one' zh 文案
```

注:文案不变,只是显式 mock 让 `t()` 走 zh 分支 (vscode 默认可能是 en,显式 mock 避免依赖测试 runner locale)。

文件:`src/test/rowPresentation.test.ts:1-3`

```ts
// 改前
import { describe, it, expect } from 'vitest'
import { renderRowPresentation, LONG_WAITING_THRESHOLD_SEC } from '../util/rowPresentation.js'
import type { SessionState } from '../types.js'

// 改后
import { describe, it, expect, vi } from 'vitest'
import { renderRowPresentation, LONG_WAITING_THRESHOLD_SEC } from '../util/rowPresentation.js'
import type { SessionState } from '../types.js'

vi.mock('vscode', () => ({ env: { language: 'zh-cn' } }))
```

其他断言 (line 28, 40, 70, 82, 94, 111, 142) 不动,文案跟 `t()` zh 输出对齐。

文件:`src/test/i18n.test.ts` — 末尾新增 (在 `describe('t() 占位符 + lang override'` 之后):

```ts
describe('i18n key 对称性', () => {
  it('en 和 zh 的 key 集合完全一致', async () => {
    const { en } = await import('../messages/en.js')
    const { zh } = await import('../messages/zh.js')
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
```

(用 `import` 函数避免循环 + lazy 加载,因为 `i18n/index.ts` 自身 import 两个 messages)

### A9. 验证 Commit A

```bash
pnpm test 2>&1 | tail -30
# 期望: 188+ tests pass (新增 1 个对称性测试,原 187)

pnpm build 2>&1 | tail -10
# 期望: 无 error

git status
# 期望: 列出修改的文件
```

### A10. Commit A

```bash
git add \
  src/extension.ts \
  src/i18n/messages/en.ts \
  src/i18n/messages/zh.ts \
  src/ui/badge.ts \
  src/util/rowPresentation.ts \
  package.json \
  package.nls.json \
  package.nls.zh-cn.json \
  src/test/badge.test.ts \
  src/test/rowPresentation.test.ts \
  src/test/i18n.test.ts

git commit -m "i18n: close v0.2.0 refactor leftovers

7 findings from /code-review @src/ on be68481:
- extension.ts: notify action buttons now use t('notify.action.*')
  (keys were defined but never referenced — en users saw Chinese buttons)
- package.nls.zh-cn.json: togglePin.title translated, missing closing ')'
- en.ts: banner.jqMissing had stray '[' from refactor
- badge.ts: sidebar badge tooltip now uses i18n (was hardcoded Chinese)
- rowPresentation.ts: STATUS_LABEL now uses i18n; renderRowPresentation
  gains vscode dependency for detectLang(), tests mock accordingly
- package.json: viewsWelcome.contents localizes via %welcome.content%
  + matching entries in package.nls.json and package.nls.zh-cn.json

i18n.test.ts: add en/zh key-set symmetry assertion to prevent future
single-side additions.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Commit B: minor bugfixes (findings 4, 8, 10)

### B1. 修 notifyMessage.ts "more" 计数

文件:`src/util/notifyMessage.ts:27`

```ts
// 改前
return t('notify.aggregate.long', n, names.join(', '), n)

// 改后
return t('notify.aggregate.long', n, names.join(', '), n - MAX_NAMES_IN_AGGREGATE)
```

### B2. 修 statusBarContent.ts "more" 计数 (同 #8 bug)

文件:`src/util/statusBarContent.ts:54`

```ts
// 改前
return t('status.tooltip.waitingManyTruncated', n, itemsStr, n)

// 改后
return t('status.tooltip.waitingManyTruncated', n, itemsStr, n - topN)
```

### B3. 更新 notifyMessage.test.ts 期望值

文件:`src/test/notifyMessage.test.ts:57`

```ts
// 改前
expect(msg).toBe('5 个会话正在等待：one, two, three 等 5 个')

// 改后
expect(msg).toBe('5 个会话正在等待：one, two, three 等 2 个')
```

### B4. 更新 statusBar.test.ts 期望值

文件:`src/test/statusBar.test.ts:82,97`

```ts
// 改前 line 82
expect(out).toBe('4 个等待权限：a 30s, b 30s, c 30s 等 4 个')

// 改后
expect(out).toBe('4 个等待权限：a 30s, b 30s, c 30s 等 1 个')

// 改前 line 97
expect(out).toBe('3 个等待权限：a 30s, b 30s 等 3 个')

// 改后
expect(out).toBe('3 个等待权限：a 30s, b 30s 等 1 个')
```

### B5. 合并 currentFilter (finding 10)

文件:`src/extension.ts:65-68`

```ts
// 改前
const cfgDefaultFilter = cfg.get<string>('defaultFilter', 'all')
const initialFilter: FilterMode = isFilterMode(cfgDefaultFilter) ? cfgDefaultFilter : 'all'
const savedFilter = context.workspaceState.get<string>(FILTER_KEY, initialFilter)
const currentFilter: FilterMode = isFilterMode(savedFilter) ? savedFilter : initialFilter
let activeFilter: FilterMode = currentFilter

// 改后
const cfgDefaultFilter = cfg.get<string>('defaultFilter', 'all')
const initialFilter: FilterMode = isFilterMode(cfgDefaultFilter) ? cfgDefaultFilter : 'all'
const savedFilter = context.workspaceState.get<string>(FILTER_KEY, initialFilter)
let activeFilter: FilterMode = isFilterMode(savedFilter) ? savedFilter : initialFilter
```

### B6. 实现 cfg 热更新 (finding 4)

文件:`src/treeDataProvider.ts:24`

```ts
// 改前
private readonly longWaitThresholdSec: number = 300

// 改后
private longWaitThresholdSec: number = 300

// 新增方法 (添加到类内,refresh 方法附近)
setLongWaitThreshold(sec: number): void {
  this.longWaitThresholdSec = sec
  this.refresh()
}
```

文件:`src/extension.ts`

line 71-72 注释修改:
```ts
// 改前
// 长等阈值 (waiting 行 icon 升级为 alert 的临界值)。从 cfg 读,默认 300 秒。
// 注入到 treeDataProvider,每行 render 时用最新值 —— cfg 修改无需重启。
const longWaitingThresholdSec = cfg.get<number>('longWaitingThresholdSec', 300)

// 改后
// 长等阈值 (waiting 行 icon 升级为 alert 的临界值)。从 cfg 读,默认 300 秒。
// cfg 修改通过 onDidChangeConfiguration 监听器热更新 —— 见下方 register。
const longWaitingThresholdSec = cfg.get<number>('longWaitingThresholdSec', 300)
```

在 `context.subscriptions.push(...)` 块(line 329-356)中追加 (在 `setFilterCommand` 之后):
```ts
// cfg 热更新:用户改 longWaitingThresholdSec 后立即生效,无需 reload window
vscode.workspace.onDidChangeConfiguration(e => {
  if (!e.affectsConfiguration('claudeTaskMonitor.longWaitingThresholdSec')) return
  const newSec = vscode.workspace.getConfiguration('claudeTaskMonitor')
    .get<number>('longWaitingThresholdSec', 300)
  provider.setLongWaitThreshold(newSec)
}),
```

注意:`onDidChangeConfiguration` 返回 `Disposable`,直接 push 进 subscriptions。无需单独 const。

### B7. 验证 Commit B

```bash
pnpm test 2>&1 | tail -30
# 期望: 188 tests pass (count 修复后断言更新,无新增/删除 test)

pnpm build 2>&1 | tail -10
# 期望: 无 error
```

### B8. Commit B

```bash
git add \
  src/extension.ts \
  src/treeDataProvider.ts \
  src/util/notifyMessage.ts \
  src/util/statusBarContent.ts \
  src/test/notifyMessage.test.ts \
  src/test/statusBar.test.ts

git commit -m "fix: cfg hot-update + correct aggregate 'more' count

3 findings from /code-review @src/ on be68481:

- extension.ts:71 misleading 'cfg 修改无需重启' comment — longWaitingThresholdSec
  was captured as const and never re-read. Add
  workspace.onDidChangeConfiguration listener that calls
  provider.setLongWaitThreshold(newSec) so the value now updates live.
  treeDataProvider.longWaitThresholdSec loses its readonly modifier
  and gains a setter that also refreshes visible rows.
- notifyMessage.ts:27 + statusBarContent.ts:54: 'more' count passed
  total n instead of (n - MAX_NAMES_IN_AGGREGATE) / (n - topN),
  so users saw e.g. '5 sessions waiting: a, b, c and 5 more' (en) /
  '5 个会话正在等待: a, b, c 等 5 个' (zh) when only 2 were truncated.
  Update test assertions to match.
- extension.ts:67-68: collapse dead currentFilter intermediate variable
  into the activeFilter initializer (1 line instead of 2).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Final verification

```bash
# 1. 测试
pnpm test 2>&1 | tail -10
# 期望: 188+ tests pass (185 原有 + 1 对称性 + 既有未变)

# 2. Build
pnpm build 2>&1 | tail -10
# 期望: 成功

# 3. Git log
git log --oneline -5
# 期望: HEAD 是 commit B,其上是 commit A,再上是 be68481 (v0.2.0 base)

# 4. Diff 概览
git diff be68481..HEAD --stat
# 期望: 8-10 个文件,+~80 / -~30 行 (i18n 增量大,minor bugs 减量大)

# 5. 工作区干净
git status
# 期望: nothing to commit
```

## Post-task

- 不发版 (用户没要求),留给后续发版 task 处理。
- 在 `.trellis/workspace/cooper/journal-1.md` 末尾追加本次记录 (沿用现有格式)。
- 完成 `task.py finish --note "i18n cleanup + minor bugfixes, 2 commits"` 收尾。

## Future work (out of scope, 记录给后续 task)

- **Finding 9** (i18n t() lang-vs-placeholder footgun): deliberate non-fix。已在 `i18n.test.ts:94-100` 显式文档化。如未来需要处理,推荐改 API 为 `t(key, lang, ...args)` 显式 lang 首参,需要审 8 个 caller。
- `extension.ts:deactivate()` 仍然有中文按钮 "是"/"否";多处其他 toast (line 84, 90, 158, 452, 459) 也是中文,不在本次 finding list,可单独 task 处理。
- integration test 覆盖 cfg `onDidChangeConfiguration` 路径 (目前只在 manual verification 测)。
