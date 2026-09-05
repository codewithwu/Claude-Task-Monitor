// 在 VS Code 集成终端里找跑 Claude 的那个(09-06 jump-to-that-terminal):
//   遍历 vscode.window.terminals,异步取每个 terminal 的 shell PID,
//   沿 PPID 链向上走找 comm=claude 的祖先,跟 SessionState.pid 对比。
//   命中后用 cwd 匹配度打分 (精确匹配 = 2, PID 命中但 cwd 不匹配 = 1),
//   取最高分;并列取第一个。
//
// 为什么不复用 liveness.ts:
//   - liveness 判定 dead/alive,我们查 comm/ppid,职责不同。
//   - 但 platform routing 的 Linux /proc vs Darwin ps 风格跟 liveness 一致,
//     这里直接复刻 (T5:不抽 hook.sh PID walking 为共享代码的设计选择)。
//
// 时序保证:
//   - processId 单点 200ms race timeout → 一个慢 terminal 不阻塞整体。
//   - walkUpToComm 单 fork 300ms + 8 层上限 → 单 terminal 理论 ≤ 2.4s,正常 ≤ 200ms。
//   - 不缓存 PID → terminal 映射:click 频率低,不需要。

import * as vscode from 'vscode'
import type { SessionState } from '../types.js'
import { walkUpToComm } from './pidAncestor.js'

/**
 * 在当前窗口的集成终端里查找运行该 session 对应 Claude 进程的 terminal。
 * 找不到返 null(交给 caller 走 fallback createTerminal)。
 */
export async function findClaudeTerminal(s: SessionState): Promise<vscode.Terminal | null> {
  if (s.pid === undefined) return null

  const terminals = vscode.window.terminals

  // 1. 并发取所有 terminal 的 processId,单点 200ms race timeout
  const withPid = await Promise.all(
    terminals.map(async term => {
      try {
        const pid = await Promise.race<number | undefined>([
          term.processId as Promise<number | undefined>,
          new Promise<undefined>(r => setTimeout(() => r(undefined), 200))
        ])
        return { term, pid }
      } catch {
        return { term, pid: undefined as number | undefined }
      }
    })
  )

  // 2. 过滤:有 PID 的,且祖先链能命中 s.pid 的
  type Candidate = { term: vscode.Terminal; score: number }
  const candidates: Candidate[] = []
  for (const { term, pid } of withPid) {
    if (!pid) continue
    const ancestor = walkUpToComm(pid, 'claude')
    if (ancestor !== s.pid) continue
    // 3. cwd 匹配评分 (PRD Q2):精确匹配 = 2,PID 命中但 cwd 不匹配 = 1
    const termCwd = (term.creationOptions as vscode.TerminalOptions).cwd
    const termCwdStr = resolveCwd(termCwd)
    const score = termCwdStr === s.cwd ? 2 : 1
    candidates.push({ term, score })
  }

  // 4. 挑最高分;并列时取第一个
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0]?.term ?? null
}

// cwd 可能是 string | Uri | undefined (vscode.TerminalOptions.cwd 的实际类型)。
// 归一成 string 便于 === 比较;Uri 类型取 fsPath(本地路径)。
function resolveCwd(cwd: string | vscode.Uri | undefined): string | undefined {
  if (typeof cwd === 'string') return cwd
  if (cwd && typeof cwd === 'object' && 'fsPath' in cwd) return cwd.fsPath
  return undefined
}
