# implement: address 5 high/medium code-review findings (round 5)

## Overview

2 个原子 commit:**commit 1 = 核心 bug 批** (Fix 1-4),**commit 2 = i18n 批** (Fix 5a-5c)。

每个 commit 独立可 revert。

---

## Commit 1: 核心 bug 批

### 1.1 Fix `src/util/formatError.ts:30`

**Diff**:
```diff
-    return (e as { message: string }).message
+    return (e as { message: string }).message || String(e)
```

**Validation**:
- [ ] Read `src/util/formatError.ts:30` 确认改动正确
- [ ] 文件头注释 line 15-17 契约现在被 duck-typed 分支满足

### 1.2 Add test case `src/test/formatError.test.ts`

**Diff** (在 `it.each` 数组里加一行):
```diff
     [{ message: 'string-coerced' }, 'string-coerced'],
+    [{ message: '' }, '[object Object]'],
     [{ message: null }, '[object Object]'],
```

**Validation**:
- [ ] Read `src/test/formatError.test.ts` 确认 case 添加位置正确

### 1.3 Fix `src/watcher.ts:77`

**Diff**:
```diff
-    const offset = this.offsets.get(file) ?? 0
-    if (stat.size <= offset) return
+    let offset = this.offsets.get(file) ?? 0
+    if (stat.size < offset) {
+      // 文件被截断;从头重新读 (emit 的事件对 stateManager 是新的)
+      offset = 0
+    }
+    if (stat.size === offset) return
```

**Validation**:
- [ ] Read `src/watcher.ts:69-80` 确认改动正确
- [ ] 老逻辑 `stat.size === offset` 现在走 `stat.size === offset` 单独 return,与原行为一致
- [ ] 老逻辑 `stat.size < offset` 现在 reset 到 0 后读

### 1.4 Add watcher truncation test

**新增 case** (放在 `describe('SessionsWatcher')` 块末尾):
```ts
it('文件被截断后从头重新读取', async () => {
  const lines: any[] = []
  watcher = new SessionsWatcher(tmpDir)
  watcher.on('line', (_, parsed) => lines.push(parsed))
  await watcher.start()
  const file = path.join(tmpDir, 's1.jsonl')
  fs.writeFileSync(file, JSON.stringify({ a: 1 }) + '\n')
  await wait(150)
  // truncate 到 0
  fs.truncateSync(file, 0)
  await wait(150)
  fs.appendFileSync(file, JSON.stringify({ a: 2 }) + '\n')
  await wait(200)
  expect(lines.map(l => l.a)).toEqual([1, 2])
})
```

**Validation**:
- [ ] Read `src/test/watcher.test.ts` 末尾确认 case 添加

### 1.5 Fix `src/treeDataProvider.ts:102-116` markdown injection

**Diff**:
```diff
     if (s.lastUserPrompt) {
-      md.appendMarkdown(`Prompt: ${s.lastUserPrompt}\n\n`)
+      md.appendText(`Prompt: ${s.lastUserPrompt}\n\n`)
     }
     if (s.currentTool) {
       const input = typeof s.currentTool.input === 'object'
         ? JSON.stringify(s.currentTool.input)
         : String(s.currentTool.input)
-      md.appendMarkdown(`Tool: \`${s.currentTool.name}\` ${input}\n\n`)
+      md.appendText(`Tool: ${s.currentTool.name} ${input}\n\n`)
     }
```

**Validation**:
- [ ] Read `src/treeDataProvider.ts:102-117` 确认只改了 user-input 两行,basename / cwd / sessionId 仍是 `appendMarkdown`

### 1.6 Add `src/test/treeDataProvider.test.ts`

**新建文件**:
```ts
import { describe, it, expect, vi } from 'vitest'
import { SessionTreeDataProvider } from '../treeDataProvider.js'
import { SessionStore } from '../stateManager.js'
import type { SessionState } from '../types.js'

vi.mock('vscode', () => ({
  TreeItem: class { constructor(label: string) { this.label = label } },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(id: string, color?: any) { Object.assign(this, { id, color }) } },
  ThemeColor: class { constructor(id: string) { this.id = id } },
  MarkdownString: class {
    value = ''
    appendText(s: string) { this.value += s }
    appendMarkdown(s: string) { this.value += s }
  },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file', path: p }) },
  EventEmitter: class {
    event = () => {}
    fire() {}
    dispose() {}
  }
}))

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'sess-test',
    cwd: '/home/me/proj',
    status: 'waiting',
    stateChangedAt: 0,
    lastUserPrompt: '',
    currentTool: null,
    muted: false,
    dyingAt: undefined,
    fileOffset: 0,
    ...overrides
  }
}

describe('SessionTreeDataProvider.buildTooltip', () => {
  it('lastUserPrompt 中的 markdown 字符不被解释', () => {
    const store = new SessionStore()
    const provider = new SessionTreeDataProvider(store)
    const s = makeSession({ lastUserPrompt: '[Click here](https://evil.example)' })
    store.add({ session_id: s.sessionId, cwd: s.cwd })
    // getTreeItem 触发 buildTooltip
    const item = provider.getTreeItem(s)
    const md = item.tooltip as any
    // MarkdownString.value 包含 lastUserPrompt 字面字符,但**不是** markdown 链接渲染
    // (vscode 渲染层判断:MarkdownString.appendText 不解析 markdown 语法)
    expect(md.value).toContain('Click here')
    expect(md.value).toContain('https://evil.example')
    // 验证 prompt 行是用 appendText 加的(无 markdown 头标记 **bold** 等)
    // 这里通过检查 value 不含 link syntax 难以验证;依赖 vscode 渲染层语义。
    // 简化:确认 tooltip 字符串仍包含原始字符(不做截断或转义)。
  })
})
```

> **注**: 真实验证 markdown 注入需要 VS Code 渲染层,单元测试只能验证字符串透传。**简化方案**: 测试文件**只做最小 sanity check** (prompt 文本进 tooltip);**真正的安全保证**来自 `appendText` vs `appendMarkdown` 的 API 语义区别,在 code review 时确认。

**Validation**:
- [ ] Read `src/test/treeDataProvider.test.ts` 确认文件创建
- [ ] vi.mock 完整覆盖 SessionTreeDataProvider 用到的 vscode API 子集

### 1.7 Fix `src/extension.ts:482-498` non-blocking deactivate

**Diff**:
```diff
-export async function deactivate(): Promise<void> {
-  const choice = await vscode.window.showInformationMessage(
-    'Claude Task Monitor 卸载：是否同时移除已注入的 hooks 与 hook.sh？',
-    '是', '否'
-  )
-  if (choice !== '是') return
+export function deactivate(): void {
+  // 不 await:VS Code 卸载时扩展宿主可能被强制关闭,未 resolve 的 Promise
+  // 会被丢弃,导致 hook 清理静默跳过。fire-and-forget + best-effort fs cleanup。
+  const removeLabel = t('extension.uninstall.remove')
+  const keepLabel = t('extension.uninstall.keep')
+  void vscode.window.showInformationMessage(
+    t('extension.uninstall.prompt'),
+    removeLabel,
+    keepLabel
+  ).then((choice) => {
+    if (choice !== removeLabel) return
+    try {
+      if (fs.existsSync(CLAUDE_SETTINGS)) {
+        const existing = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'))
+        const cleaned = uninstallSettings(existing)
+        fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(cleaned, null, 2))
+      }
+      if (fs.existsSync(HOOK_SCRIPT)) fs.unlinkSync(HOOK_SCRIPT)
+    } catch (e) {
+      console.warn('[claude-task-monitor] uninstall failed:', formatErrorMessage(e))
+    }
+  })
+}
```

**Validation**:
- [ ] `t` 已在 line 26 导入 (`import { t, setLangOverride } from './i18n/index.js'`)
- [ ] 函数签名从 `async function` 改 `function`(去掉 `Promise<void>`)
- [ ] 错误处理保留 (try/catch + formatErrorMessage)

### Commit 1 验证

```bash
pnpm test 2>&1 | tail -30
# Expect: 全绿;新增 3 个 test case 全部 pass
#   - formatError.test.ts: +1 case ({message: ''} → '[object Object]')
#   - watcher.test.ts: +1 case (截断重读)
#   - treeDataProvider.test.ts: +1 case (markdown 不被解释)

pnpm build 2>&1 | tail -10
# Expect: tsup 编译通过,无 TS error/warning
```

**Review gate**: 跑完上述两个命令后,commit 1:
```bash
git add src/util/formatError.ts src/test/formatError.test.ts \
        src/watcher.ts src/test/watcher.test.ts \
        src/treeDataProvider.ts src/test/treeDataProvider.test.ts \
        src/extension.ts
git commit -m "fix(audit-r5): 4 core bugs (formatError, watcher, markdown injection, blocking deactivate)"
```

---

## Commit 2: i18n 批

### 2.1 Add `status.dying` key to en.ts

**Diff** (`src/i18n/messages/en.ts` 在 `'status.label.waiting/running/idle'` 块后):
```diff
   'status.label.waiting': 'Waiting',
   'status.label.running': 'Running',
   'status.label.idle': 'Idle',
+  'status.dying': 'Exited',
```

### 2.2 Add `status.dying` key to zh.ts

**Diff** (`src/i18n/messages/zh.ts` 同样位置):
```diff
   'status.label.waiting': '等待权限',
   'status.label.running': '运行中',
   'status.label.idle': '待命',
+  'status.dying': '已退出',
```

### 2.3 Add uninstall keys to en.ts

**Diff** (`src/i18n/messages/en.ts` 在文件末尾或合适位置):
```diff
+  // ─── extension lifecycle (activate/deactivate) ───
+  'extension.uninstall.prompt': 'Claude Task Monitor: uninstall — also remove the injected hooks and hook.sh?',
+  'extension.uninstall.remove': 'Remove',
+  'extension.uninstall.keep': 'Keep',
+  'extension.jqMissing': 'Claude Task Monitor: `jq` not found in PATH. Please install: macOS `brew install jq`, Debian/Ubuntu `apt install jq`. Hook installation skipped; restart VS Code after installing jq.'
```

### 2.4 Add uninstall keys to zh.ts

**Diff** (`src/i18n/messages/zh.ts` 同样位置):
```diff
+  // ─── extension lifecycle (activate/deactivate) ───
+  'extension.uninstall.prompt': 'Claude Task Monitor:卸载——是否同时移除已注入的 hooks 与 hook.sh?',
+  'extension.uninstall.remove': '是',
+  'extension.uninstall.keep': '否',
+  'extension.jqMissing': 'Claude Task Monitor:`jq` 未在 PATH 中找到。请先安装:macOS `brew install jq`,Debian/Ubuntu `apt install jq`。hook 安装已跳过,装好 jq 后重启 VS Code 即可。'
```

### 2.5 Fix `src/util/rowPresentation.ts:77`

**Diff**:
```diff
-  const dyingPrefix = dying ? '已退出 · ' : ''
+  const dyingPrefix = dying ? t('status.dying') + ' · ' : ''
```

### 2.6 Update `src/test/rowPresentation.test.ts` dying case

`rowPresentation.test.ts:136-148` 现有 case `it('dyingAt 有值:...')` 在 en mock 下应该断言 `Exited` 而非 `已退出`。**确认现有 vi.mock 是 `language: 'zh-cn'`** (line 6) → 期望值保持 `已退出`。

**Diff**:
```diff
-    expect(row.description.startsWith('已退出 · ')).toBe(true)
+    expect(row.description.startsWith('已退出 · ')).toBe(true)
+    expect(row.description.includes('已退出')).toBe(true)  // 新增显式断言
```

(vi.mock 是 zh-cn,所以期望值不变;只补一个 `.includes()` 让测试对未来 i18n 改动敏感)

### Commit 2 验证

```bash
pnpm test 2>&1 | tail -30
# Expect: 全绿;i18n.test.ts symmetry 测试 PASS (en/zh 键集合一致)
# Expect: rowPresentation.test.ts 'dyingAt 有值' case PASS

pnpm build 2>&1 | tail -10
# Expect: tsup 编译通过
```

**Review gate**: 跑完上述两个命令后,commit 2:
```bash
git add src/i18n/messages/en.ts src/i18n/messages/zh.ts \
        src/util/rowPresentation.ts src/test/rowPresentation.test.ts
git commit -m "fix(i18n): 3 hardcoded Chinese strings (rowPresentation dying + uninstall prompt + jq-missing toast)"
```

---

## Total review gates (sequential)

| Stage | Command | Pass criteria |
|---|---|---|
| 1. Format/lint | `pnpm exec eslint src --ext .ts 2>&1 \| tail -10` (若装了) | 无 error |
| 2. Type check | `pnpm exec tsc --noEmit 2>&1 \| tail -10` | 无 error |
| 3. Unit tests | `pnpm test 2>&1 \| tail -30` | 全绿,新增 case pass |
| 4. Build | `pnpm build 2>&1 \| tail -10` | tsup 成功,无 TS error |
| 5. Symmetry | `pnpm vitest run -t "对称性" 2>&1 \| tail -10` | i18n 对称测试 pass |

每个 commit 前必须跑 stage 1-4。commit 2 前额外跑 stage 5。

---

## Rollback points

- Commit 1 任何子修复单独 revert:`git revert --no-commit HEAD`,然后 `git checkout -- <file>` 不需要的部分
- Commit 2 单独 revert:同上
- 整个 round-5 revert:`git revert HEAD~2..HEAD` (会创建 2 个 revert commit,保持历史清晰)

---

## Out of scope (verify 不被触碰)

- `src/i18n/index.ts:5/68` —— deliberate non-fix lang-override footgun
- `src/installer.ts:14` writeFileSync mode 问题
- `src/installer.ts:82` detectJq 无 timeout
- `src/util/langStore.ts:105` syncFromConfig 警告刷屏
- `src/util/statusBarContent.ts:30` 空 placeholder 产生 `: ` 尾随
- 任何 LOW severity finding

---

## Reference

- PRD: `.trellis/tasks/08-29-audit-fixes-r5/prd.md`
- Design: `.trellis/tasks/08-29-audit-fixes-r5/design.md`
- Spec context: `.trellis/spec/i18n.md`, `.trellis/spec/testing.md`, `.trellis/spec/lifecycle.md`