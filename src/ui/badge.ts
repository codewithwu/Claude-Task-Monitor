// sidebar 图标徽标:waiting 数 ≥ 1 时显示数字。
// waiting = 0 不显示徽标,sidebar 图标恢复默认。
//
// 背景:VS Code 1.86+ 才支持 TreeView<T>.badge,已在 R2 升级 engines。
// ViewBadge 是 { value: string; tooltip?: string },颜色由 VS Code 主题决定。

import * as vscode from 'vscode'
import type { SessionStore } from '../stateManager.js'

export function applyBadge(treeView: vscode.TreeView<unknown>, store: SessionStore): void {
  const waiting = store.list().filter(s => s.status === 'waiting').length
  treeView.badge = waiting > 0
    ? { value: waiting, tooltip: `${waiting} 个会话正在等待权限确认` }
    : undefined
}