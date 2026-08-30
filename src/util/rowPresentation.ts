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
//   dying        → circle-slash  + descriptionForeground (liveness 检测到进程死亡)

import type { SessionState } from '../types.js'
import { humanizeDuration } from './time.js'
import { projectName } from './pathNames.js'
import { summarizeTool } from './toolSummary.js'
import { t } from '../i18n/index.js'

export interface RowPresentation {
  label: string
  description: string
  iconId: string
  iconColor: string
}

// tooltip 还要拼同一套状态文案,导出供 treeDataProvider 复用,避免双份
export const statusLabel = (status: SessionState['status']): string =>
  t(`status.label.${status}` as const)

// 长等阈值默认值(秒)。测试 / 默认值复用,真正的值由 caller 从 cfg 注入。
export const DEFAULT_LONG_WAITING_THRESHOLD_SEC = 5 * 60

type IconKey = 'dying' | 'waiting-short' | 'waiting-long' | 'running' | 'idle'

const ICON: Record<IconKey, { iconId: string; iconColor: string }> = {
  'dying':         { iconId: 'circle-slash',  iconColor: 'descriptionForeground' },
  'waiting-short': { iconId: 'circle-filled', iconColor: 'charts.red' },
  'waiting-long':  { iconId: 'alert',         iconColor: 'errorForeground' },
  'running':       { iconId: 'sync~spin',     iconColor: 'charts.yellow' },
  'idle':          { iconId: 'circle-outline',iconColor: 'charts.green' }
}

export function renderRowPresentation(
  s: SessionState,
  elapsedSec: number,
  longWaitThresholdSec: number = DEFAULT_LONG_WAITING_THRESHOLD_SEC
): RowPresentation {
  // elapsed 由 caller 算好传入 (跟 treeDataProvider tooltip 共用同一份计算),
  // 这里只负责压成 ≥ 0,不重新读 Date.now() —— 避免双源时间漂移
  const safeElapsed = Math.max(0, elapsedSec)
  const project = projectName(s.cwd)

  const dying = s.dyingAt !== undefined
  const longWait = s.status === 'waiting' && safeElapsed >= longWaitThresholdSec
  // waiting 行 + 没 dying 时才暴露 currentTool (tooltip / label / description 共用)
  const showTool = s.status === 'waiting' && s.currentTool !== null && !dying

  const iconKey: IconKey = dying
    ? 'dying'
    : s.status === 'waiting' ? (longWait ? 'waiting-long' : 'waiting-short')
    : s.status === 'running' ? 'running'
    : 'idle'

  // label: waiting 行拼 toolSummary + projectName (设计初心 —— 等什么余光可见)
  const label = showTool
    ? `${summarizeTool(s.currentTool!)} · ${project}`
    : project

  // description: dying 时加 "已退出" 前缀 + 等待时长;正常时 status + tool + duration
  const dyingPrefix = dying ? t('status.dying') + ' · ' : ''
  const toolPart = showTool ? ` · ${s.currentTool!.name}` : ''
  const description = `${dyingPrefix}${statusLabel(s.status)}${toolPart} · ${humanizeDuration(safeElapsed)}`

  const { iconId, iconColor } = ICON[iconKey]
  return { label, description, iconId, iconColor }
}