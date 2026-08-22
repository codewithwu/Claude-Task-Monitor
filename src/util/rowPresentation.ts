// 把 SessionState 折叠成 sidebar 行的纯数据结构 (label / description / iconId / iconColor)。
// 拆出来是为了:treeDataProvider.ts 可以只管 vscode.TreeItem 装配,
// 渲染规则本身可以纯函数测试,不依赖 vscode 模块。
//
// 设计意图:让「等什么」+「等多久」在余光里可读,长命令不撑爆 sidebar。
//
// 视觉编码:形状 + 颜色双通道(色盲友好)
//   waiting 短等 → circle-filled  + charts.red
//   waiting 长等 → alert         + errorForeground
//   running      → sync~spin     + charts.yellow  (内置动画,sidebar 中可见旋转)
//   idle         → circle-outline + charts.green

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

// 长等阈值默认值(秒)。测试 / 默认值复用,真正的值由 caller 从 cfg 注入。
export const DEFAULT_LONG_WAITING_THRESHOLD_SEC = 5 * 60

// 保留旧名导出用于既有测试,值跟默认对齐。⚠️ 不要再用于生产路径,
// 行 41 的 longWaitThreshold 参数化让 cfg 可控。
export const LONG_WAITING_THRESHOLD_SEC = DEFAULT_LONG_WAITING_THRESHOLD_SEC

export function renderRowPresentation(
  s: SessionState,
  elapsedSec: number,
  longWaitThresholdSec: number = DEFAULT_LONG_WAITING_THRESHOLD_SEC
): RowPresentation {
  // elapsed 由 caller 算好传入 (跟 treeDataProvider tooltip 共用同一份计算),
  // 这里只负责压成 ≥ 0,不重新读 Date.now() —— 避免双源时间漂移
  const safeElapsed = Math.max(0, elapsedSec)
  const projectName = path.basename(s.cwd) || s.cwd

  const longWait = s.status === 'waiting' && safeElapsed >= longWaitThresholdSec
  // dying 状态 (liveness 检测到进程死亡,等待 2s 视觉反馈后移除):
  //   icon 改 circle-slash (切割感,跟正常 status 区分),颜色改 descriptionForeground
  //   description 加 "已退出" 前缀,跟正常 status 文字区分
  const dying = s.dyingAt !== undefined

  // icon: 形状 + 颜色双编码 —— 色盲用户也能区分状态
  let iconId: string
  let iconColor: string
  if (dying) {
    iconId = 'circle-slash'
    iconColor = 'descriptionForeground'
  } else if (s.status === 'waiting') {
    iconId = longWait ? 'alert' : 'circle-filled'
    iconColor = longWait ? 'errorForeground' : 'charts.red'
  } else if (s.status === 'running') {
    // sync~spin 是 VS Code 内置旋转动画 codicon (1.86+)
    iconId = 'sync~spin'
    iconColor = 'charts.yellow'
  } else {
    iconId = 'circle-outline'
    iconColor = 'charts.green'
  }

  // label: waiting 行拼 toolSummary + projectName (设计初心 —— 等什么余光可见)
  const label = (s.status === 'waiting' && s.currentTool && !dying)
    ? `${summarizeTool(s.currentTool)} · ${projectName}`
    : projectName

  // description: dying 时加 "已退出" 前缀 + 等待时长;正常时 status + tool + duration
  const dyingPrefix = dying ? '已退出 · ' : ''
  const toolPart = (s.status === 'waiting' && s.currentTool && !dying) ? ` · ${s.currentTool.name}` : ''
  const description = `${dyingPrefix}${STATUS_LABEL[s.status]}${toolPart} · ${humanizeDuration(safeElapsed)}`

  return { label, description, iconId, iconColor }
}