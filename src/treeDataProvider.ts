import * as vscode from 'vscode'
import * as path from 'node:path'
import type { SessionState } from './types'
import type { SessionStore } from './stateManager'
import { humanizeDuration } from './util/time'

const STATUS_ICON: Record<SessionState['status'], { id: string; color: string }> = {
  waiting: { id: 'circle-filled', color: 'charts.red' },
  running: { id: 'circle-filled', color: 'charts.yellow' },
  idle:    { id: 'circle-filled', color: 'charts.green' }
}

const STATUS_LABEL: Record<SessionState['status'], string> = {
  waiting: '等待权限',
  running: '运行中',
  idle:    '待命'
}

export class SessionTreeDataProvider implements vscode.TreeDataProvider<SessionState> {
  private _onDidChange = new vscode.EventEmitter<SessionState | undefined>()
  readonly onDidChangeTreeData = this._onDidChange.event

  constructor(private readonly store: SessionStore) {
    store.onChange(() => this.refresh())
  }

  refresh(): void {
    this._onDidChange.fire(undefined)
  }

  getTreeItem(s: SessionState): vscode.TreeItem {
    const item = new vscode.TreeItem(path.basename(s.cwd) || s.cwd, vscode.TreeItemCollapsibleState.None)
    const icon = STATUS_ICON[s.status]
    item.iconPath = new vscode.ThemeIcon(icon.id, new vscode.ThemeColor(icon.color))
    const elapsedSec = Math.max(0, Math.floor(Date.now() / 1000) - s.stateChangedAt)
    item.description = `${STATUS_LABEL[s.status]} · ${humanizeDuration(elapsedSec)}`
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
    md.appendMarkdown(`**${path.basename(s.cwd) || s.cwd}** · ${STATUS_LABEL[s.status]} · ${humanizeDuration(elapsedSec)}\n\n`)
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
