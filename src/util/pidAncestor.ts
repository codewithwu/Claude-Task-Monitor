// 跨平台 walk-up-PID-tree 工具(09-06 jump-to-that-terminal):
//   给定一个起始 PID,沿 PPID 链向上查找 comm 等于 target 的祖先 PID。
//   用于把 VS Code 集成终端的 shell PID 映射回真正的 claude CLI PID。
//
// 设计要点:
//   - 不复用 liveness.ts:liveness 判定 dead/alive,这里查 comm/ppid,职责不同。
//   - 失败一律返回 null —— 保守路径,跟 isProcessGone 同款 "unknown = fallback"。
//   - 不支持 win32:Claude Code CLI 在 Windows 上跑在 WSL2,扩展 host 进程
//     看不到 WSL guest PID(跨 PID 命名空间)→ 直接返 null → caller 走 fallback。
//   - claude 4 字符不会被 macOS ps -o comm= 的 16 字符截断影响,但仍 trim
//     尾随空格,跟 resources/hook.sh 一致。
//   - 默认 maxDepth=8(经验值:shell→node→claude 深度 ≤4)+ 单 fork timeoutMs=300
//     → 单次 walkUpToComm 理论耗时 ≤ 2.4s,正常 ≤ 200ms。

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'

/**
 * 从 startPid 沿 PPID 链向上走,查找 comm 等于 target 的祖先 PID。
 * 返回命中的 PID,或 null(未找到 / 平台不支持 / 任意子调用失败)。
 */
export function walkUpToComm(
  startPid: number,
  target: string,
  opts: { maxDepth?: number; timeoutMs?: number } = {}
): number | null {
  // 非法 PID 短路 —— 不抛错,不抛 warn,跟 isProcessGone 同保守风格
  if (!Number.isInteger(startPid) || startPid <= 0) return null
  if (!target) return null

  const maxDepth = opts.maxDepth ?? 8
  const timeoutMs = opts.timeoutMs ?? 300

  let current: number = startPid
  for (let i = 0; i < maxDepth && current > 1; i++) {
    const comm = getComm(current, timeoutMs)
    if (comm !== null && comm === target) return current
    const ppid = getPpid(current, timeoutMs)
    if (ppid <= 1) return null
    current = ppid
  }
  return null
}

// 读 /proc/<pid>/comm (Linux) 或 ps -o comm= -p <pid> (macOS)。
// 失败返 null(包括进程已死、/proc 不可读、平台不支持)。
function getComm(pid: number, timeoutMs: number): string | null {
  try {
    if (process.platform === 'linux') {
      return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim()
    }
    if (process.platform === 'darwin') {
      const out = execFileSync('ps', ['-o', 'comm=', '-p', String(pid)], {
        encoding: 'utf8',
        timeout: timeoutMs
      })
      // macOS ps 字段尾随空格 + 16 字符截断;claude 4 字符不受影响但统一处理
      return out.replace(/\s+$/, '')
    }
    return null
  } catch {
    return null
  }
}

// 读 /proc/<pid>/status 的 PPid 字段 (Linux) 或 ps -o ppid= -p <pid> (macOS)。
// 失败返 0(PID 1 是 init,任何链遇 0/1 都视为终止)。
function getPpid(pid: number, timeoutMs: number): number {
  try {
    if (process.platform === 'linux') {
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8')
      const m = status.match(/^PPid:\s+(\d+)/m)
      return m ? Number(m[1]) : 0
    }
    if (process.platform === 'darwin') {
      const out = execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], {
        encoding: 'utf8',
        timeout: timeoutMs
      }).trim()
      const n = Number(out)
      return Number.isInteger(n) && n > 0 ? n : 0
    }
    return 0
  } catch {
    return 0
  }
}
