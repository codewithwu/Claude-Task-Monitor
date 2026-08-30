// 把 SessionState[] 按 status 分组为顶层 group 节点。
// 纯函数:不依赖 vscode 模块,可独立单测。
//
// 设计要点:
//   - 固定顺序:Waiting → Running → Idle (按"用户最关心程度"排序,不是字典序)
//   - 空组不渲染:filter='all' 时 count=0 的 status 跳过,避免视觉噪音
//   - filter='waiting' 等单值模式:即使 count=0 也返回该 group,
//     让 sidebar 仍展示"我选了过滤模式",而不是看似无数据

import { SessionGroup } from '../types.js'
import type { FilterMode, SessionState } from '../types.js'
import { STATUS_ORDER } from '../types.js'

export function groupByStatus(sessions: ReadonlyArray<SessionState>, filter: FilterMode): SessionGroup[] {
  if (filter === 'all') {
    // 只渲染非空 group
    return STATUS_ORDER
      .filter(status => sessions.some(s => s.status === status))
      .map(status => new SessionGroup(status))
  }
  // 单值过滤:即使该 status 没有 session,也返回一个 group,
  // 渲染层会自然展开为 0 个 children —— 让用户看到"当前过滤模式生效中"。
  return [new SessionGroup(filter)]
}

export function applyFilter(sessions: ReadonlyArray<SessionState>, filter: FilterMode): SessionState[] {
  if (filter === 'all') return [...sessions]
  return sessions.filter(s => s.status === filter)
}