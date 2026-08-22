// 右下角 status bar 项:始终反映 CTM 是否在线 + 有几个会话在等权限。
//
// 设计意图:sidebar 可能被用户折叠/隐藏,徽标和树视图都看不到 ——
// status bar 是 VS Code 永远显示的一栏,把"我还在监控"和"有 waiting"
// 钉在这里,余光里不会丢。
//
// 渲染规则 (与父 design.md §4 / D2 对齐):
//   N=0       → $(pulse) CTM
//   waiting≥1 → $(pulse) CTM: W⚠
//   waiting 时 tooltip 列前 3 个 waiting 项目名 + 时长,多于 3 个用 "等 N 个" 收尾

import * as vscode from 'vscode'
import type { SessionStore } from '../stateManager.js'
import { computeStatusBarContent, formatWaitingTooltip } from '../util/statusBarContent.js'

export const FOCUS_SESSIONS_VIEW_COMMAND = 'claudeTaskMonitor.focusSessionsView'

export class StatusBar {
  private readonly item: vscode.StatusBarItem

  constructor() {
    // Right + priority 100:让出 priority 0 给 git/language 等更高频信号
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    )
    this.item.command = FOCUS_SESSIONS_VIEW_COMMAND
    this.item.name = 'Claude Task Monitor'
    this.item.show()
  }

  update(store: SessionStore): void {
    const sessions = store.list()
    const content = computeStatusBarContent(sessions)
    this.item.text = content.text
    // 有 waiting 时 tooltip 升级为 top-3 项目列表,让用户不展开 sidebar 也能定位
    const waiting = sessions.filter(s => s.status === 'waiting')
    const tooltip = waiting.length > 0
      ? formatWaitingTooltip(waiting)
      : content.tooltip
    this.item.tooltip = tooltip
  }

  dispose(): void {
    this.item.dispose()
  }
}