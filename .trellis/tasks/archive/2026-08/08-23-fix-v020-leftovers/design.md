# Design: v0.2.0 leftover fixes

## 1. 架构总览

本 task 不引入新模块、不改 API 形状。所有改动都是 **已有 i18n 模块 + cfg 系统的局部收尾**。

```
src/
├── i18n/
│   ├── index.ts              # 不动
│   └── messages/
│       ├── en.ts             # 新增 badge.tooltip.* / status.label.*;修 banner.jqMissing
│       └── zh.ts             # 同上 (key 必须对齐)
├── ui/
│   └── badge.ts              # tooltip 走 t()
├── util/
│   ├── rowPresentation.ts    # STATUS_LABEL 走 t() (函数变为依赖 vscode)
│   ├── notifyMessage.ts      # 修 "more" 计数
│   └── statusBarContent.ts   # 同修
└── extension.ts              # 通知按钮走 t();合并 currentFilter;cfg 热更新监听

package.json                  # viewsWelcome 改 %welcome.content%
package.nls.json              # 新增 welcome.content (en)
package.nls.zh-cn.json        # 修复 togglePin;新增 welcome.content (zh)
src/treeDataProvider.ts       # readonly → mutable;新增 setter
```

## 2. 关键设计决策

### 2.1 viewsWelcome 本地化用 nls 占位符

VS Code 原生支持 `package.json` 里用 `%key%` 占位符,从 `package.nls.json` / `package.nls.zh-cn.json` 解析。已有的 18 个 command title 都走这条路径 (`"title": "%command.copySessionId.title%"`)。`viewsWelcome.contents` 也支持同样机制。

不需要引入运行时 i18n,因为 `viewsWelcome` 是在 `package.json` 静态加载阶段由 VS Code 解析。

**en 版本文案**:
```
## Don't see your Claude sessions?

Start `claude` in a terminal and they'll appear automatically — first sidebar refresh may take 1-2 seconds.

### Still nothing? Try these:

[Install hook](command:claudeTaskMonitor.installHook) · [Show onboarding](command:claudeTaskMonitor.showOnboarding)

[Settings](command:workbench.action.openSettings,["claudeTaskMonitor"]) · [Open docs](command:claudeTaskMonitor.openDocs)

> Tip: confirm `jq` is installed (macOS `brew install jq` / Debian-Ubuntu `apt install jq`). When missing, a red banner appears at the top of the sidebar.
```

(基于现有 zh 文案意译,保留 4 个 command link + 1 个 jq 提示 + `> Tip` markdown 引用块)

### 2.2 badge tooltip i18n

新增 2 个 key (en/zh 对称):

| key | en | zh |
|-----|----|----|
| `badge.tooltip.one` | `1 session waiting for permission` | `1 个会话正在等待权限确认` |
| `badge.tooltip.many` | `{0} sessions waiting for permission` | `{0} 个会话正在等待权限确认` |

`applyBadge` 改为:
```ts
treeView.badge = waiting > 0
  ? {
      value: waiting,
      tooltip: waiting === 1
        ? t('badge.tooltip.one')
        : t('badge.tooltip.many', waiting)
    }
  : undefined
```

测试更新:`badge.test.ts:46` 改为 mock `vscode.env.language = 'zh-cn'` 后断言新文案 (与 `notifyMessage.test.ts:7` 同模式)。

### 2.3 rowPresentation status labels i18n

新增 3 个 key:

| key | en | zh |
|-----|----|----|
| `status.label.waiting` | `Waiting` | `等待权限` |
| `status.label.running` | `Running` | `运行中` |
| `status.label.idle` | `Idle` | `待命` |

**取舍点**:`renderRowPresentation` 原本是纯函数 (不依赖 vscode),`src/test/rowPresentation.test.ts` 也是纯函数测试。i18n 化会引入 `import { t } from '../i18n/index.js'`,`t()` 内部 `import * as vscode from 'vscode'`。

**两种解法对比**:

| 解法 | 优点 | 缺点 |
|------|------|------|
| A. `renderRowPresentation` 直接 `import { t }` (依赖 vscode) | 一致性最好,跟 `notifyMessage` / `statusBarContent` 模式统一 | 失去纯函数属性;测试要 mock vscode |
| B. `renderRowPresentation` 接受预翻译的 labels map 参数 (调用方注入) | 保持纯函数 | 增加一个参数;每个调用点都要构造 labels;lose single source of truth |

**选 A**。理由:
1. 现有 16 个 `src/test/*.test.ts` 里 3 个 (`notifyMessage.test.ts`、`statusBar.test.ts`、`i18n.test.ts`) 已经在用 `vi.mock('vscode', ...)`,模式成熟。
2. `t()` 内部对 `vscode.env.language` 的访问是 lazy (只在 `detectLang()` 调用时发生),用 `vi.mock` 之后完全可控。
3. 单一职责优先于"纯函数洁癖" —— 渲染层的语义已经包括"按用户 locale 输出 label",在函数内部完成更直接。

实现:
```ts
// rowPresentation.ts
import { t } from '../i18n/index.js'

function statusLabelKey(status: SessionState['status']): string {
  return `status.label.${status}` as const
}

export const statusLabel = (status: SessionState['status']): string =>
  t(statusLabelKey(status))

// renderRowPresentation 内:
//   STATUS_LABEL[s.status]  →  t(statusLabelKey(s.status))
```

测试 `src/test/rowPresentation.test.ts` 头部新增 `vi.mock('vscode', () => ({ env: { language: 'zh-cn' } }))` (跟 `notifyMessage.test.ts:7` 同),断言沿用现有中文文案。

### 2.4 cfg 热更新 (finding 4 真正实现)

现有实现问题:
```ts
// extension.ts:72
const longWaitingThresholdSec = cfg.get<number>('longWaitingThresholdSec', 300)
// ...
const provider = new SessionTreeDataProvider(store, () => activeFilter, longWaitingThresholdSec)
// treeDataProvider.ts:24
private readonly longWaitThresholdSec: number = 300
```

值在 activate 时捕获,既不监听 cfg,字段又是 readonly。

**修复方案**:
1. `treeDataProvider.ts:24` `readonly` → 可变,新增方法:
   ```ts
   setLongWaitThreshold(sec: number): void {
     this.longWaitThresholdSec = sec
     this.refresh()  // 立即重渲染所有可见行
   }
   ```
2. `extension.ts` 在 activate 注册监听:
   ```ts
   context.subscriptions.push(
     vscode.workspace.onDidChangeConfiguration(e => {
       if (e.affectsConfiguration('claudeTaskMonitor.longWaitingThresholdSec')) {
         const newSec = vscode.workspace.getConfiguration('claudeTaskMonitor')
           .get<number>('longWaitingThresholdSec', 300)
         provider.setLongWaitThreshold(newSec)
       }
     })
   )
   ```
3. `extension.ts:71-72` 注释改为准确描述:
   ```ts
   // 长等阈值 (waiting 行 icon 升级为 alert 的临界值)。从 cfg 读,默认 300 秒。
   // cfg 修改通过 onDidChangeConfiguration 监听器热更新 —— 见下方 register。
   ```

**为什么选热更新而非只改注释**:
- R3 明确要求"立即用新阈值"
- 用户体感差异:reload window 会丢失 sidebar 展开状态、filter 选择、uncommitted edits
- 实现成本:8 行新增 + 1 个 setter
- 监听器跟现有的 `setFilterCommand`(line 293-300) 模式完全一致 (ctx.subscriptions.push 注册 + provider 状态变更 + refresh)

### 2.5 notify aggregate "more" 计数修复

两处同 bug:
- `notifyMessage.ts:27`: `t('notify.aggregate.long', n, names.join(', '), n)`
- `statusBarContent.ts:54`: `t('status.tooltip.waitingManyTruncated', n, itemsStr, n)`

修复 (两处统一):
```ts
// notifyMessage.ts
return t('notify.aggregate.long', n, names.join(', '), n - MAX_NAMES_IN_AGGREGATE)
// statusBarContent.ts
return t('status.tooltip.waitingManyTruncated', n, itemsStr, n - topN)
```

测试断言:
- `notifyMessage.test.ts:57` `'... 等 5 个'` → `'... 等 2 个'`
- `statusBar.test.ts:82` `'... 等 4 个'` → `'... 等 1 个'`
- `statusBar.test.ts:97` `'... 等 3 个'` → `'... 等 1 个'`

en 版本同样 (`'... and 5 more'` → `'... and 2 more'`)。

### 2.6 合并 currentFilter (finding 10)

```ts
// 改前 (4 行)
const currentFilter: FilterMode = isFilterMode(savedFilter) ? savedFilter : initialFilter
let activeFilter: FilterMode = currentFilter

// 改后 (1 行)
let activeFilter: FilterMode = isFilterMode(savedFilter) ? savedFilter : initialFilter
```

注释保留 (line 60-62 解释为什么用 `let` 而不是 `const`)。

## 3. Deliberate non-fix: i18n t() lang detection

**Finding 9**:`t(key, ...args)` 遍历 args 时,把字面量 `'zh'`/`'en'` 当 lang override 吞掉。如果某个 i18n key 真的想传 'en'/'zh' 作为占位符,会被静默丢弃。

**不修理由**:
1. 现有 36 个 key 全部枚举过 (`en.ts` + `zh.ts`),无 key 把 `'en'`/`'zh'` 作为占位符值。
2. `i18n.test.ts:94-100` 显式断言这个行为 (`t('notify.single', 'en', 'Bash')` 返回 `'Bash waiting for permission: {1}'`),保留 = 测试通过 = 行为稳定。
3. 修法只有两种,都有明显缺点:
   - **A. 改 API 为 `t(key, args, lang?)` 显式 lang 末位** —— 需要审计所有 8 个 caller,行为不向后兼容。
   - **B. 检测 `'zh'/'en'` 必须是 enum 值而非常见字符串** —— 类型上 `'zh' | 'en'` 已经是字面量,运行时无法区分 caller 意图是"传 lang"还是"传字符串 'en'"。需要 caller 自觉用 `t(key, ..., 'en' as Lang)`,运行时成本高,文档化反而比现状更脆弱。
4. 跟项目"自建轻量 i18n,vscode.l10n 不必要的体积"的初旨一致:接受一个边界 case 的 footgun,换取 0 依赖。

**记录位置**:`i18n/index.ts` 头部注释已说明 "lang override 自动识别" 的语义;`i18n.test.ts:96-98` 已文档化 caveat。本 task 不新增内容,但在 `implement.md` 的 "Future work" 段提及,让后续 task 知情。

## 4. Test strategy

### 4.1 i18n key 对称性

新增 `src/test/i18n.test.ts` 段:
```ts
describe('i18n key 对称性', () => {
  it('en 和 zh 的 key 集合完全一致 (差异会触发 console.warn 但不阻断)', () => {
    const enKeys = Object.keys(en).sort()
    const zhKeys = Object.keys(zh).sort()
    expect(enKeys).toEqual(zhKeys)
  })
})
```
防止后续 task 单边加 key 制造新的 #3 类 bug。

### 4.2 mock 模式统一

新引入 i18n 的测试文件统一用:
```ts
vi.mock('vscode', () => ({ env: { language: 'zh-cn' } }))
```

需要更新的测试:
- `src/test/badge.test.ts` — 加 mock,改 tooltip 断言
- `src/test/rowPresentation.test.ts` — 加 mock,status label 断言不变 (沿用中文)
- `src/test/notifyMessage.test.ts` — 已 mock,只改 "more" 计数断言
- `src/test/statusBar.test.ts` — 已 mock,只改 "more" 计数断言

### 4.3 cfg 监听测试

不在 unit test 覆盖 (`vscode.workspace.onDidChangeConfiguration` 需要 e2e/integration 触发)。
在 `src/test/integration/` 下不新增 — 现有 integration test 覆盖范围未涉及 cfg hot-reload,跟现状保持一致。
cfg 改动路径靠手动验证 (开 settings.json 改 + 看 sidebar icon 立即升级)。

## 5. Commit plan

| Commit | 包含 finding | 文件数 | 性质 |
|--------|--------------|--------|------|
| **A: i18n cleanup** | #1, 2, 3, 5, 6, 7 | 7-8 | 纯文案/结构,无行为变更(除 en locale 看到的文案) |
| **B: minor bugfixes** | #4 (cfg 监听), #8 (count 修复 ×2 处), #10 (currentFilter 合并) | 4 | 有行为变更:cfg 热更新生效;通知文案 "等 N 个" 数字变小 |

Commit message 模板:
- A: `i18n: close v0.2.0 refactor leftovers (7 findings)`
- B: `fix: cfg hot-update + correct aggregate 'more' count + simplify filter init`

## 6. Rollback

- Commit A revert: 用户重新看到中文 UI (回归到 v0.2.0 release 状态)。无功能影响。
- Commit B revert: cfg 改动需 reload (回归)、通知文案 "等 N 个" 数字偏大、currentFilter 多 1 个中间变量。功能行为回归到 v0.2.0。
- 两个 commit 都独立可 revert。
