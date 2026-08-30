// 把 waiting 会话列表折叠成桌面通知文案。
// 单条沿用旧格式(兼容性 + 体感不变),聚合用新格式。
// 文案从 src/i18n 取 —— 用户 locale 决定中英。

import type { WaitingSession } from '../notifier.js'
import { t } from '../i18n/index.js'
import { projectName } from './pathNames.js'

const MAX_NAMES_IN_AGGREGATE = 3

// 单条通知文案:跟旧版本结构对齐 (project + tool),文案走 i18n
export function formatSingleMessage(s: WaitingSession): string {
  return t('notify.single', projectName(s.cwd), s.toolName)
}

// 聚合通知文案:
//   - 1 个:不调用此函数(走 formatSingleMessage)
//   - 2~3 个:列出全部
//   - ≥4 个:列前 MAX_NAMES_IN_AGGREGATE 个 + "等 N 个" (N 是被截断的实际数量,
//     即 n - MAX_NAMES_IN_AGGREGATE —— "还有多少没列出来")
export function formatAggregateMessage(sessions: ReadonlyArray<WaitingSession>): string {
  const names = sessions.slice(0, MAX_NAMES_IN_AGGREGATE).map(s => projectName(s.cwd))
  const n = sessions.length
  if (n <= MAX_NAMES_IN_AGGREGATE) {
    return t('notify.aggregate.short', n, names.join(', '))
  }
  return t('notify.aggregate.long', n, names.join(', '), n - MAX_NAMES_IN_AGGREGATE)
}