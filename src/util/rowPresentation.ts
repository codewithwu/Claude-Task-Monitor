// 把 SessionState 折叠成 sidebar 行的纯数据结构 (label / description / iconId / iconColor)。
// 拆出来是为了:treeDataProvider.ts 可以只管 vscode.TreeItem 装配,
// 渲染规则本身可以纯函数测试,不依赖 vscode 模块。
//
// 设计意图:让「等什么」+「等多久」在余光里可读,长命令不撑爆 sidebar。

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

// waiting ≥ 5 分钟视觉升级:从普通圆点升到警示三角 + 主题色换 error
export const LONG_WAITING_THRESHOLD_SEC = 5 * 60

export function renderRowPresentation(s: SessionState, elapsedSec: number): RowPresentation {
  // elapsed 由 caller 算好传入 (跟 treeDataProvider tooltip 共用同一份计算),
  // 这里只负责压成 ≥ 0,不重新读 Date.now() —— 避免双源时间漂移
  const safeElapsed = Math.max(0, elapsedSec)
  const projectName = path.basename(s.cwd) || s.cwd

  const longWait = s.status === 'waiting' && safeElapsed >= LONG_WAITING_THRESHOLD_SEC

  // icon: waiting 长等 → alert + errorForeground;否则按 status 配色
  let iconId: string
  let iconColor: string
  if (s.status === 'waiting') {
    iconId = longWait ? 'alert' : 'circle-filled'
    iconColor = longWait ? 'errorForeground' : 'charts.red'
  } else if (s.status === 'running') {
    iconId = 'circle-filled'
    iconColor = 'charts.yellow'
  } else {
    iconId = 'circle-filled'
    iconColor = 'charts.green'
  }

  // label: waiting 行拼 toolSummary + projectName (设计初心 —— 等什么余光可见)
  const label = (s.status === 'waiting' && s.currentTool)
    ? `${summarizeTool(s.currentTool)} · ${projectName}`
    : projectName

  // description: waiting 行插入 tool_name;duration 永远末尾
  const toolPart = (s.status === 'waiting' && s.currentTool) ? ` · ${s.currentTool.name}` : ''
  const description = `${STATUS_LABEL[s.status]}${toolPart} · ${humanizeDuration(safeElapsed)}`

  return { label, description, iconId, iconColor }
}