import * as vscode from 'vscode'
import * as path from 'node:path'
import type { SessionState } from './types.js'
import type { SessionStore } from './stateManager.js'
import { humanizeDuration } from './util/time.js'
import { renderRowPresentation, statusLabel } from './util/rowPresentation.js'

export class SessionTreeDataProvider implements vscode.TreeDataProvider<SessionState> {
  private _onDidChange = new vscode.EventEmitter<SessionState | undefined>()
  readonly onDidChangeTreeData = this._onDidChange.event

  // bound 一份,这样 offChange 能精确移除同一引用 (this.onStoreChange 每次
  // 调用会创建新箭头函数,remove 不掉 —— 之前 #8 finding 的根因)
  private readonly onStoreChange = () => this.refresh()

  constructor(private readonly store: SessionStore) {
    store.onChange(this.onStoreChange)
  }

  dispose(): void {
    this.store.offChange(this.onStoreChange)
    this._onDidChange.dispose()
  }

  refresh(): void {
    this._onDidChange.fire(undefined)
  }

  getTreeItem(s: SessionState): vscode.TreeItem {
    const elapsedSec = Math.max(0, Math.floor(Date.now() / 1000) - s.stateChangedAt)
    const row = renderRowPresentation(s, elapsedSec)

    const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None)
    item.iconPath = new vscode.ThemeIcon(row.iconId, new vscode.ThemeColor(row.iconColor))
    item.description = row.description
    item.tooltip = this.buildTooltip(s, elapsedSec)
    item.command = {
      command: 'vscode.openFolder',
      arguments: [vscode.Uri.file(s.cwd), { forceNewWindow: false }],
      title: 'Open Project'
    }
    item.contextValue = `session-${s.status}`
    return item
  }

  getChildren(): SessionState[] {
    return this.store.list()
  }

  private buildTooltip(s: SessionState, elapsedSec: number): vscode.MarkdownString {
    const md = new vscode.MarkdownString()
    md.appendMarkdown(`**${path.basename(s.cwd) || s.cwd}** · ${statusLabel(s.status)} · ${humanizeDuration(elapsedSec)}\n\n`)
    md.appendMarkdown(`\`${s.cwd}\`\n\n`)
    if (s.lastUserPrompt) {
      md.appendMarkdown(`Prompt: ${s.lastUserPrompt}\n\n`)
    }
    if (s.currentTool) {
      const input = typeof s.currentTool.input === 'object'
        ? JSON.stringify(s.currentTool.input)
        : String(s.currentTool.input)
      md.appendMarkdown(`Tool: \`${s.currentTool.name}\` ${input}\n\n`)
    }
    md.appendMarkdown(`Session: \`${s.sessionId}\``)
    return md
  }
}