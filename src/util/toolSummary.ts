// 把 PreToolUse 留下的 tool { name, input } 折叠成 sidebar label 用的人类可读短串。
// 设计意图:让「等什么」在余光里可读,同时压住 sidebar 行宽,避免长命令撑爆。
//
// 规则:
//   - Bash: command 字符串本身(空白归一化)
//   - Edit/Write/MultiEdit/Read: file_path 的 basename
//   - WebFetch: url
//   - 其他工具 / 不可解析 input: 仅 tool name
//
// 长度兜底:超过 MAX_SUMMARY_LEN 的串末尾加 … 截断。

import { posix as pathPosix } from 'node:path'

const MAX_SUMMARY_LEN = 60

export interface ToolSummaryInput {
  name: string
  input: unknown
}

export function summarizeTool({ name, input }: ToolSummaryInput): string {
  if (!input || typeof input !== 'object') return name

  // Bash: 抓 command;不是字符串则降级
  if (name === 'Bash') {
    const cmd = (input as { command?: unknown }).command
    if (typeof cmd === 'string') {
      return truncate(cmd.replace(/\s+/g, ' ').trim(), MAX_SUMMARY_LEN)
    }
    return name
  }

  // 文件类工具: file_path 的 basename。
  // 原生 Windows Claude Code 会发 C:\Users\me\src\auth.ts (\\ 分隔);
  // WSL/Linux Claude Code 发 /home/me/proj/auth.ts (/ 分隔)。
  // 在 POSIX 系统上跑 node:path.basename 不会认 \,所以先归一化:把 \\ 换成 /,
  // 再用 path.posix.basename —— 这样两平台都拿到正确 basename。
  if (name === 'Edit' || name === 'Write' || name === 'MultiEdit' || name === 'Read') {
    const filePath = (input as { file_path?: unknown }).file_path
    if (typeof filePath === 'string' && filePath.length > 0) {
      const normalized = filePath.replace(/\\/g, '/')
      return pathPosix.basename(normalized)
    }
    return name
  }

  // WebFetch: 截断 url
  if (name === 'WebFetch') {
    const url = (input as { url?: unknown }).url
    if (typeof url === 'string') {
      return truncate(url, MAX_SUMMARY_LEN)
    }
    return name
  }

  return name
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}