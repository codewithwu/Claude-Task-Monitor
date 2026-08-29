# design: address 5 high/medium code-review findings (round 5)

## Architecture overview

5 个修复分布在 4 个文件,跨 4 个域(契约 / 安全 / 正确性 / 生命周期 / i18n)。每个修复独立、最小 diff、不影响模块边界。

```
src/
├── util/formatError.ts          ← Fix 1: 空串兜底
├── treeDataProvider.ts          ← Fix 2: markdown 注入
├── watcher.ts                   ← Fix 3: 截断重置
├── extension.ts                 ← Fix 4: 非阻塞 deactivate
├── util/rowPresentation.ts      ← Fix 5a: i18n dying 前缀
├── i18n/messages/en.ts          ← Fix 5b/5c: i18n 新 key (en)
├── i18n/messages/zh.ts          ← Fix 5b/5c: i18n 新 key (zh)
└── test/                        ← 4 个新测试用例
```

## Fix-by-fix design

### Fix 1: `src/util/formatError.ts:30` — duck-typed 空串兜底

**当前**:
```ts
return (e as { message: string }).message
```

**改为**:
```ts
return (e as { message: string }).message || String(e)
```

**为什么这样改**: 与第 23 行 `instanceof Error` 分支对齐 (`e.message || String(e)`)。文件头注释 (line 15-17) 明文契约 *「每一段都保证 t() 拿到非空字符串」* —— 当前 duck-typed 分支违反这个契约。

**测试新增** (`src/test/formatError.test.ts`):
```ts
[{ message: '' }, '[object Object]'],   // 新增 case
```

**回退风险**: 无。`String({ message: '' })` = `'[object Object]'`,与已存在的 `[{ message: null }, '[object Object]']` case 行为一致。

---

### Fix 2: `src/treeDataProvider.ts:102-116` — tooltip markdown 注入

**当前问题**: `buildTooltip` 把 `s.lastUserPrompt` 和 `currentTool.input` 直接拼进 `appendMarkdown` 模板字符串。MarkdownString 的 `appendMarkdown` **不转义** markdown 元字符。`s.lastUserPrompt` 是用户在 Claude Code CLI 里输入的文本,内容不可信。

**修复策略**: 用 `MarkdownString.appendText` 替代 `appendMarkdown` 处理用户输入部分;`appendMarkdown` 只保留给受控结构(项目名 basename、statusLabel、sessionId)。`appendText` 的实现是把字符串按字面字符追加,不解释 markdown 语法(参考 VS Code API 文档)。

**当前**:
```ts
if (s.lastUserPrompt) {
  md.appendMarkdown(`Prompt: ${s.lastUserPrompt}\n\n`)  // ← 注入点
}
if (s.currentTool) {
  const input = typeof s.currentTool.input === 'object'
    ? JSON.stringify(s.currentTool.input)
    : String(s.currentTool.input)
  md.appendMarkdown(`Tool: \`${s.currentTool.name}\` ${input}\n\n`)  // ← 注入点
}
```

**改为**:
```ts
if (s.lastUserPrompt) {
  md.appendText(`Prompt: ${s.lastUserPrompt}\n\n`)
}
if (s.currentTool) {
  const input = typeof s.currentTool.input === 'object'
    ? JSON.stringify(s.currentTool.input)
    : String(s.currentTool.input)
  md.appendText(`Tool: ${s.currentTool.name} ${input}\n\n`)
}
```

**保留 `appendMarkdown` 的部分**:
- `md.appendMarkdown(\`**${path.basename(s.cwd) || s.cwd}** · ${statusLabel(s.status)} · ${humanizeDuration(elapsedSec)}\n\n\`)` —— 受控
- `md.appendMarkdown(\`\`${s.cwd}\`\`\n\n)` —— `s.cwd` 由 Claude Code 设置,信任域内
- `md.appendMarkdown(\`Session: \`${s.sessionId}\`\`)` —— sessionId 是我们生成的 UUID,受控

**为什么不替换 `s.cwd` 也用 appendText**: cwd 由 hook 从 Claude Code 进程拿,理论上 Claude Code 可以输出恶意 cwd,但 MarkdownString 自身有 XSS 防护(`isTrusted` 默认 false 时 `supportHtml` 也 false,且 HTML 在 markdown 里不会被解释)。具体可注入点是 markdown link `[label](url)` —— cwd 中括号不影响渲染。**风险评估: 低**。

**为什么不引入 `escape()` helper**: VS Code 的 `MarkdownString` 本身就提供 `appendText` (字面字符) vs `appendMarkdown` (解析 markdown) 的语义区分,这是官方推荐做法,不需要额外 helper。

**测试**: treeDataProvider 没有现成测试文件(spec 提到「无 test file currently」)。本次**新增** `src/test/treeDataProvider.test.ts`,验证包含 `[Click here](https://evil.com)` 的 lastUserPrompt 在 `buildTooltip` 后不会变成 clickable link。

---

### Fix 3: `src/watcher.ts:77` — JSONL 截断偏移重置

**当前**:
```ts
const offset = this.offsets.get(file) ?? 0
if (stat.size <= offset) return
```

**bug**: `stat.size < offset` 时直接 return。文件被截断(从 N 字节变成 < N 字节)后,新写入的内容(0..stat.size)永远不被读取,直到文件被删除+重建。

**修复策略**: 当 `stat.size < offset`,认为文件被截断,从 0 开始读。已知新内容是 0..stat.size(所有事件都是重新生成的);emit 的事件是 stateManager 之前没见过的。

**改为**:
```ts
let offset = this.offsets.get(file) ?? 0
if (stat.size < offset) {
  // 文件被截断:从头重新读;emit 的事件对 stateManager 是新的
  offset = 0
}
if (stat.size === offset) return
```

**为什么不是 `offsets.delete(file)`**: 我们要立刻读 stat.size 的内容,不等下一次 change 事件循环。

**为什么不通知 stateManager "之前的 events 撤回"**: SessionStore 的 reduce() 设计是 idempotent-friendly 的;重新走一遍 SessionStart/PreToolUse 不会破坏状态(后续 SessionEnd / removeByPid 会清理)。JSONL 截断是异常路径,不引入额外信号通道。

**测试新增** (`src/test/watcher.test.ts`):
```ts
it('文件截断后从头重新读取,不丢失内容', async () => {
  // 写 100 字节 → 截断到 50 字节 → 写新内容
  // 验证所有 emit 的 line 事件不重复且不丢
})
```

---

### Fix 4: `src/extension.ts:482` — 非阻塞 `deactivate()`

**当前**:
```ts
export async function deactivate(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(...)
  if (choice !== '是') return
  try { ...fs cleanup... } catch (e) { ... }
}
```

**bug**: VS Code 卸载扩展时,扩展宿主可能强制退出,未 resolve 的 `await` Promise 被丢弃。VS Code 文档明示 *deactivate must not block on UI*。

**修复策略**: 移除 `async/await`,改为 `void ... .then()` fire-and-forget。`t()` 同步调用先准备好按钮标签字符串,避免 `.then` 内重复解析。

**改为**:
```ts
export function deactivate(): void {
  // 不 await:VS Code 卸载时可能强制退出扩展宿主,未 resolve 的 Promise
  // 会被丢弃,导致 hook 清理静默跳过。fire-and-forget 是文档推荐的 best-effort。
  const removeLabel = t('extension.uninstall.remove')
  const keepLabel = t('extension.uninstall.keep')
  void vscode.window.showInformationMessage(
    t('extension.uninstall.prompt'),
    removeLabel,
    keepLabel
  ).then((choice) => {
    if (choice !== removeLabel) return
    try {
      if (fs.existsSync(CLAUDE_SETTINGS)) {
        const existing = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'))
        const cleaned = uninstallSettings(existing)
        fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(cleaned, null, 2))
      }
      if (fs.existsSync(HOOK_SCRIPT)) fs.unlinkSync(HOOK_SCRIPT)
    } catch (e) {
      console.warn('[claude-task-monitor] uninstall failed:', formatErrorMessage(e))
    }
  })
}
```

**为什么不把卸载逻辑搬到 activate() 里注册 disposable**: 当前调用方 (`extension.ts`) 不持有 context(activate 函数是 sync,deactivate 是 async)。改造范围太大,超出本次 ROI。

**为什么不引入异步卸载队列**: 简单 best-effort 即可覆盖 99% 场景;队列化是后续 task。

**测试**: VS Code extension host 卸载不在 vitest 覆盖范围。手动验证:卸载扩展时弹窗正常出现,点击 Remove 后 settings.json 清理完成。

---

### Fix 5a: `src/util/rowPresentation.ts:77` — i18n dying 前缀

**当前**:
```ts
const dyingPrefix = dying ? '已退出 · ' : ''
```

**bug**: en 用户 UI 出现中文。08-23 修了 `status.label.*` 三个 key 但漏了这个 dying 前缀。

**修复**:
```ts
const dyingPrefix = dying ? t('status.dying') + ' · ' : ''
```

**i18n key 命名**: `status.dying` (2-level,平行 `banner.jqMissing`)。area=`status` 与已有 `status.label.*` 一致;`dying` 是临时状态而非 SessionStatus,故不复用 `status.label.*` 命名空间。

**测试新增** (`src/test/rowPresentation.test.ts`):
```ts
// 已存在 case 'dyingAt 有值' 加一行:
//   expect(row.description.startsWith('已退出 · ')).toBe(true)
// 改用 key 字符串检查:在 en mock 下应该是 'Exited'
```

---

### Fix 5b: `src/extension.ts:484` — i18n 卸载提示 + 按钮

**修复**: 见 Fix 4,按钮标签和提示都走 `t()`。

**新增 i18n keys**:
| Key | en | zh |
|---|---|---|
| `extension.uninstall.prompt` | `Claude Task Monitor: uninstall — also remove the injected hooks and hook.sh?` | `Claude Task Monitor:卸载——是否同时移除已注入的 hooks 与 hook.sh?` |
| `extension.uninstall.remove` | `Remove` | `是` |
| `extension.uninstall.keep` | `Keep` | `否` |

**Override 决策**: 08-23 任务明确把卸载按钮列为 out of scope,理由「不顺手本地化会扩散 scope」。本次 round-5 用户明确点名要修,**override**。

---

### Fix 5c: `src/extension.ts:97` — i18n jq-missing toast

**当前**:
```ts
void vscode.window.showErrorMessage(
  'Claude Task Monitor: `jq` 未在 PATH 中找到。请先安装：macOS `brew install jq`，Debian/Ubuntu `apt install jq`。hook 安装已跳过,装好 jq 后重启 VS Code 即可。'
)
```

**修复**:
```ts
void vscode.window.showErrorMessage(t('extension.jqMissing'))
```

**新增 i18n key** `extension.jqMissing`:
| Locale | Value |
|---|---|
| en | `Claude Task Monitor: \`jq\` not found in PATH. Please install: macOS \`brew install jq\`, Debian/Ubuntu \`apt install jq\`. Hook installation skipped; restart VS Code after installing jq.` |
| zh | `Claude Task Monitor: \`jq\` 未在 PATH 中找到。请先安装:macOS \`brew install jq\`,Debian/Ubuntu \`apt install jq\`。hook 安装已跳过,装好 jq 后重启 VS Code 即可。` |

**保留 shell 命令不翻译**: `brew install jq` / `apt install jq` 是 shell 命令,在 zh/en 下都保持原样。

---

## Data flow

**修复前**: 用户输入 → JSONL hook → watcher → store → reducer → state → treeDataProvider → `MarkdownString.appendMarkdown` → 用户点击 hook (XSS 风险)

**修复后**: 用户输入 → JSONL hook → watcher → store → reducer → state → treeDataProvider → `MarkdownString.appendText` (字面字符) → 用户看到纯文本

i18n 流不变:`t('status.dying')` 走 `detectLang()` → `Lang` type → 对应 message 表 → 渲染。

## Tradeoffs

| 决策 | 备选 | 选这个的理由 |
|---|---|---|
| duck-typed 分支兜底 = `String(e)` | 抛异常 | 与 Error 分支对齐;避免上层处理 throw |
| 截断重置 offset = 0 | 删 offsets entry | 立刻读 stat.size 新内容,不等事件循环 |
| `deactivate` 改 sync + `.then()` | 引入卸载队列 | best-effort 覆盖 99% 场景;队列化超出 ROI |
| 新 key 命名 `status.dying` | `row.dying` | 与 `status.label.*` 同 area,grep 一致 |
| treeDataProvider 测试**新增**文件 | 跳过测试 | 安全 fix 必须有回归测试;spec 写「无 test file currently」是当前状态,不是禁止新增 |
| 不动 `t()` lang-override footgun | 修 | deliberate non-fix,已 documented + tested |

## Compatibility & rollback

- 不改 public API (`t()` 签名、`formatErrorMessage` 签名、`watcher` 事件名都不变)
- i18n 新 key 是 strict addition;symmetry test 强制 en+zh 同步
- commit 拆 2 个原子:核心 bug + i18n,任何一批独立 revert 不影响另一批
- `deactivate()` 从 `async` 改 `function`:VS Code 扩展 manifest 不依赖 deactivate 返回 Promise(它本来就被允许 sync)

## Rollback shape

单 commit revert 即可。`deactivate()` 改回 `async` 会丢失非阻塞语义,但不会编译失败。i18n revert 会留下「t('extension.uninstall.prompt') 不存在 key」的 fallback(`t()` 默认回退到 key 字符串),无崩溃。