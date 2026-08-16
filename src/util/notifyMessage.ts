// 把 waiting 会话列表折叠成桌面通知文案。
// 单条沿用老格式(兼容性 + 体感不变),聚合用新格式。

import { posix as pathPosix } from 'node:path'
import type { WaitingSession } from '../notifier.js'

const MAX_NAMES_IN_AGGREGATE = 3

// 单条通知文案:跟旧版本逐字对齐,确保现有截图/测试/用户习惯不被破坏
export function formatSingleMessage(s: WaitingSession): string {
  return `${displayNameOf(s.cwd)} 等待权限确认：${s.toolName}`
}

// 聚合通知文案:
//   - 1 个:不调用此函数(走 formatSingleMessage)
//   - 2~3 个:列出全部
//   - ≥4 个:列前 MAX_NAMES_IN_AGGREGATE 个 + "等 N 个"
export function formatAggregateMessage(sessions: ReadonlyArray<WaitingSession>): string {
  const names = sessions.slice(0, MAX_NAMES_IN_AGGREGATE).map(s => displayNameOf(s.cwd))
  const n = sessions.length
  if (n <= MAX_NAMES_IN_AGGREGATE) {
    return `${n} 个会话正在等待：${names.join(', ')}`
  }
  return `${n} 个会话正在等待：${names.join(', ')} 等 ${n} 个`
}

// 跨平台 cwd basename:把 \ 归一为 / 再用 posix.basename,
// Windows (C:\Users\me\proj) 和 POSIX (/home/me/proj) 都正确。
function displayNameOf(p: string): string {
  return pathPosix.basename(p.replace(/\\/g, '/')) || p
}