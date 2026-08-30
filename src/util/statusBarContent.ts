// 纯函数:从 session 列表算出 status bar 文案 + tooltip。
// 拆出来便于单测,StatusBar 类只负责 vscode 装配 (避免测试 import vscode 模块)。
//
// 文案走 i18n:用户 locale 自动决定中英文。

import { humanizeDuration, nowSec, elapsedSince } from './time.js'
import { projectName } from './pathNames.js'
import { t } from '../i18n/index.js'
import type { SessionState, SessionStatus } from '../types.js'

export interface StatusBarContent {
  text: string
  tooltip: string
}

const TOP_WAITING_IN_TOOLTIP = 3

export function computeStatusBarContent(sessions: ReadonlyArray<{ status: SessionStatus }>): StatusBarContent {
  const total = sessions.length
  let waiting = 0
  for (const s of sessions) if (s.status === 'waiting') waiting++

  if (waiting === 0) {
    return {
      text: `$(pulse) ${t('status.label')}`,
      tooltip: t('status.tooltip.empty', total)
    }
  }
  return {
    text: `$(pulse) ${t('status.label')}: ${t('status.waitingSuffix', waiting)}`,
    tooltip: t('status.tooltip.waitingMany', waiting, '')
  }
}

// 状态栏 hover tooltip 专用:列出前 N 个 waiting session 的项目名 + 等待时长。
// N 由 TOP_WAITING_IN_TOOLTIP 控制(默认 3);多于 N 的用 "等 N 个" 收尾。
// 输入是完整 SessionState[](需要 cwd + stateChangedAt),由 StatusBar 调用。
export function formatWaitingTooltip(
  waitingSessions: ReadonlyArray<SessionState>,
  nowSecValue: number = nowSec(),
  topN: number = TOP_WAITING_IN_TOOLTIP
): string {
  if (waitingSessions.length === 0) return ''
  const items = waitingSessions.slice(0, topN).map(s =>
    `${projectName(s.cwd)} ${humanizeDuration(elapsedSince(s.stateChangedAt, nowSecValue))}`
  )
  const n = waitingSessions.length
  const itemsStr = items.join(', ')
  if (n <= topN) {
    return t('status.tooltip.waitingMany', n, itemsStr)
  }
  // 等 N 个:N 是被截断的实际数量 (n - topN),即"还有多少没列出来"
  return t('status.tooltip.waitingManyTruncated', n, itemsStr, n - topN)
}