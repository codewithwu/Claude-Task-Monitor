# Design — 跳转到「那个终端」

> PRD: `prd.md`. 本文聚焦技术边界、模块拆分、跨平台分支、回滚形态。

## 架构总览

```
                ┌─────────────────────────────────┐
   右键 / CP    │  openClaudeTerminal(s)          │
   ────────────►│   ├─ try focus matching term   │
                │   │   (新)                       │
                │   ├─ fallback: create new +     │
                │   │   show toast (Q1=B 决议)    │
                │   └─ term.show()                │
                └─────────────────────────────────┘
                              │
                              ▼
                ┌─────────────────────────────────┐
                │  findTerminalByPid(s.pid, s.cwd)│
                │   遍历 vscode.window.terminals  │
                │   并发取 processId                │
                │   对每个 shell PID 调            │
                │     walkUpToClaude(shellPid)    │
                │   命中且 cwd 匹配 → 返 term      │
                └─────────────────────────────────┘
                              │
                              ▼
                ┌─────────────────────────────────┐
                │  walkUpToComm(pid, target)      │
                │   src/util/pidAncestor.ts       │
                │   平台分支:                     │
                │     Linux → /proc + awk         │
                │     Darwin → ps -o comm=,ppid=  │
                │     其他 → 返回 null             │
                │   超时 800ms (execFileSync 各     │
                │   子调用 ≤300ms,合计 ≤3 层)     │
                └─────────────────────────────────┘
```

## 模块拆分（新增 / 改动）

| 模块 | 类型 | 责任 |
|------|------|------|
| `src/util/pidAncestor.ts` | 新增 | 跨平台 `walkUpToComm(pid, target): number \| null`。单一文件单一职责，便于单测 |
| `src/util/pidAncestor.test.ts` | 新增 | 跨平台 PID 树测试（复用 `setSelfComm` 模式） |
| `src/util/findClaudeTerminal.ts` | 新增 | 遍历 `vscode.window.terminals`，组合 processId + walkUpToComm + cwd 匹配，返回匹配 terminal 或 null |
| `src/util/findClaudeTerminal.test.ts` | 新增 | mock `vscode.window.terminals`，验证 cwd 匹配 / 多命中挑选 |
| `src/extension.ts` | 改动 | `openClaudeTerminal` 改写：先调 `findClaudeTerminal` → 命中则 show；未命中 fallback createTerminal + 弹一次性 toast |
| `src/i18n/messages/{zh,en}.ts` | 改动 | 新 key `toast.terminal.notFound`，文案按当前回退策略 |

**不**改 `resources/hook.sh`：hook.sh 的 PID walking 已经稳定并有 e2e 测，本次不动避免回归风险（见 PRD Q3）。

## 关键算法

### `walkUpToComm(pid, target)` —— `src/util/pidAncestor.ts`

```typescript
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'

export function walkUpToComm(
  startPid: number,
  target: string,
  opts: { maxDepth?: number; timeoutMs?: number } = {}
): number | null {
  const maxDepth = opts.maxDepth ?? 8   // 经验值:shell→node→claude 深度≤4
  const timeoutMs = opts.timeoutMs ?? 300 // 单次 fork 上限
  let current = startPid
  for (let i = 0; i < maxDepth && current > 1; i++) {
    if (getComm(current, timeoutMs) === target) return current
    current = getPpid(current, timeoutMs)
    if (current <= 1) return null
  }
  return null
}

function getComm(pid: number, timeoutMs: number): string | null {
  try {
    if (process.platform === 'linux') {
      return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim()
    }
    if (process.platform === 'darwin') {
      const out = execFileSync('ps', ['-o', 'comm=', '-p', String(pid)], {
        encoding: 'utf8', timeout: timeoutMs
      }).trim()
      // macOS ps 字段尾随空格 + 16 字符截断,claude 4 字符不受影响但统一处理
      return out.replace(/\s+$/, '')
    }
    return null
  } catch { return null }
}

function getPpid(pid: number, timeoutMs: number): number {
  try {
    if (process.platform === 'linux') {
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8')
      const m = status.match(/^PPid:\s+(\d+)/m)
      return m ? Number(m[1]) : 0
    }
    if (process.platform === 'darwin') {
      const out = execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], {
        encoding: 'utf8', timeout: timeoutMs
      }).trim()
      return Number(out) || 0
    }
    return 0
  } catch { return 0 }
}
```

**注意点**：
- `claude` 4 字符不会被 16 字符截断影响；但仍然 `.trim()` / `replace(/\s+$/, '')`，跟 hook.sh 一致
- 失败一律返回 null（保守），跟 `isProcessGone` 同款 "unknown = fallback"
- 不支持 win32：Claude Code CLI 在 Windows 上跑在 WSL2，扩展 host 进程看不到 WSL guest PID（除非用 wsl.exe spawn，复杂度爆炸）；本期直接返 null → 走 fallback

### `findTerminalByPid(s)` —— `src/util/findClaudeTerminal.ts`

```typescript
import * as vscode from 'vscode'
import { walkUpToComm } from './pidAncestor.js'

export async function findClaudeTerminal(s: SessionState): Promise<vscode.Terminal | null> {
  if (s.pid === undefined) return null

  const terminals = vscode.window.terminals
  // 1. 并发取 processId (单点超时)
  const withPid = await Promise.all(
    terminals.map(async term => {
      try {
        const pid = await Promise.race([
          term.processId as Promise<number | undefined>,
          new Promise<undefined>(r => setTimeout(() => r(undefined), 200))
        ])
        return { term, pid }
      } catch {
        return { term, pid: undefined as number | undefined }
      }
    })
  )

  // 2. 过滤:有 pid 的,且祖先里能命中 s.pid 的
  const candidates: { term: vscode.Terminal; score: number }[] = []
  for (const { term, pid } of withPid) {
    if (!pid) continue
    const ancestor = walkUpToComm(pid, 'claude')
    if (ancestor !== s.pid) continue
    // 3. cwd 匹配评分
    const termCwd = (term.creationOptions as vscode.TerminalOptions).cwd
    const termCwdStr = typeof termCwd === 'string' ? termCwd
                     : termCwd && 'fsPath' in termCwd ? termCwd.fsPath
                     : undefined
    const score = termCwdStr === s.cwd ? 2 : 1
    candidates.push({ term, score })
  }

  // 4. 挑最高分;并列时第一个
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0]?.term ?? null
}
```

**算法说明**：
- 并发取 `processId`：200ms 单点超时避免一个未响应 terminal 卡住整体
- `walkUpToComm` 内部 300ms 单 fork 上限 + 最多 8 层 → 单 terminal 总耗时 ≤2.4s 理论值（正常 ≤200ms）
- cwd 评分：精确匹配 = 2；非匹配但 PID 链命中 = 1；取最高分（PRD Q2 决议 = "cwd 最匹配"，无并列时退化为 PID 命中即可）

### `openClaudeTerminal(s)` —— `src/extension.ts:467` 改写

```typescript
async function openClaudeTerminal(s: SessionState): Promise<void> {
  const matched = await findClaudeTerminal(s)
  if (matched) {
    matched.show()
    return
  }
  // Fallback (Q1=B): 仍开新 terminal + 弹一次性 toast
  const term = vscode.window.createTerminal({
    cwd: s.cwd,
    name: `claude: ${projectName(s.cwd)}`
  })
  term.show()
  void vscode.window.showInformationMessage(t('toast.terminal.notFound'))
}
```

**Toast 文案**（中英）：
- zh: `未找到正在运行该 claude 进程的集成终端，已在新终端中打开`
- en: `No integrated terminal found running this Claude process — opened a new one instead.`

## 跨平台矩阵

| 平台 | processId 可用 | walkUpToComm | 总判定 |
|------|----------------|---------------|--------|
| Linux (含 WSL2 guest) | ✅ | ✅ /proc 直读 | ✅ |
| macOS | ✅ | ✅ ps 兜底 | ✅ |
| Windows host (跑原生 CLI) | ❌ | ❌ 无 /proc、无 ps | → fallback + toast |
| WSL2 host 看 WSL guest claude | ❌ (processId 是 host pid) | ❌ 跨 PID namespace | → fallback + toast，列入 README 已知局限 |

## 兼容性 / 迁移

- **配置文件**：无新增 setting（Q1=B 不需要 D 那种配置项）
- **旧 hook**：完全兼容，本期不改 `resources/hook.sh`
- **数据格式**：`SessionState.pid` 已存在；不需要 schema 变更
- **i18n**：新增 2 个 key（zh/en），按现有 PR 模式补

## 关键 trade-offs

| 决策 | 收益 | 代价 |
|------|------|------|
| 不抽 hook.sh 的 PID walking 为共享代码 | 两边独立演进、不引入 bash↔Node spawn 复杂度 | 逻辑双份；维护 hook.sh 时要同步 Node 端 |
| `walkUpToComm` 单次 300ms + 8 层上限 | 防止异常进程树导致慢路径 | 极端深嵌套（多层 ssh + container）会被截断 |
| cwd 评分排序而非完全相等匹配 | 跨平台路径归一化（`/private/tmp` vs `/tmp` on macOS）的健壮性 | 可能选到 "cwd 不完全相等但 PID 命中" 的 term，UX 上仍是"对的 tab" |
| 并发取 `processId` | 用户感知延迟低 | N 个 terminal × 一次 IPC 调用（一般 5ms 级） |
| 不在 openClaudeTerminal 内部缓存 PID → terminal 映射 | 实现简单 | 同一 session 多次点击会重跑；click 频率低，OK |

## 回滚形态

- 单文件回滚：`git revert <commit>` 只影响 `src/extension.ts` + 新增 `src/util/{pidAncestor,findClaudeTerminal}.ts`；删两个新 util 即可恢复 createTerminal 行为
- Toast 文案独立 key，删 key 即等于"静默 fallback"（回到 Q1=A 行为）
- 不影响 hook.sh / liveness.ts / stateManager.ts / notifier.ts 任何已有路径
