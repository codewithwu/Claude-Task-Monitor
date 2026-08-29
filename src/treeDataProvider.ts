import * as vscode from 'vscode'
import * as path from 'node:path'
import type { FilterMode, SessionState, TreeElement } from './types.js'
import { SessionGroup } from './types.js'
import type { SessionStore } from './stateManager.js'
import { humanizeDuration } from './util/time.js'
import { renderRowPresentation, statusLabel } from './util/rowPresentation.js'
import { groupByStatus, applyFilter } from './util/groupByStatus.js'

// TreeView 嵌套分组:顶层 Waiting/Running/Idle group,下层 SessionState。
// filter 由 caller 注入 (通过 getFilter 闭包),filter 变化只需 refresh(),
// 不需要重新构造 provider —— 跟 store.onChange 走同一刷新路径。
export class SessionTreeDataProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChange = new vscode.EventEmitter<TreeElement | undefined>()
  readonly onDidChangeTreeData = this._onDidChange.event

  // bound 一份,这样 offChange 能精确移除同一引用 (this.onStoreChange 每次
  // 调用会创建新箭头函数,remove 不掉 —— 之前 #8 finding 的根因)
  private readonly onStoreChange = () => this.refresh()

  constructor(
    private readonly store: SessionStore,
    private readonly getFilter: () => FilterMode = () => 'all',
    private longWaitThresholdSec: number = 300
  ) {
    store.onChange(this.onStoreChange)
  }

  // cfg 热更新入口:cfg.onDidChangeConfiguration 监听器改值后调用,
  // 同时 refresh() 让所有可见 waiting 行用新阈值重渲染。
  setLongWaitThreshold(sec: number): void {
    this.longWaitThresholdSec = sec
    this.refresh()
  }

  dispose(): void {
    this.store.offChange(this.onStoreChange)
    this._onDidChange.dispose()
  }

  refresh(): void {
    this._onDidChange.fire(undefined)
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    if (element instanceof SessionGroup) {
      return this.getGroupItem(element)
    }
    return this.getSessionItem(element)
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (!element) {
      // Root: 按 filter 返回 group 列表 (filter='all' 时跳过空 group)
      return groupByStatus(this.store.list(), this.getFilter())
    }
    if (element instanceof SessionGroup) {
      // group 展开:同 status 的 session 列表,按 filter 二次过滤
      // (filter='all' 时等于 no-op,但走同一份 applyFilter 保持一致)
      return applyFilter(
        this.store.list().filter(s => s.status === element.status),
        this.getFilter()
      )
    }
    return []
  }

  private getGroupItem(g: SessionGroup): vscode.TreeItem {
    const count = this.store.list().filter(s => s.status === g.status).length
    const item = new vscode.TreeItem(
      `${statusLabel(g.status)} (${count})`,
      // 始终展开:group 只是逻辑分组容器,折叠反而让用户多一次点击。
      // 如果未来 session 多到需要折叠,再改 CollapsibleState.Collapsed + persist。
      vscode.TreeItemCollapsibleState.Expanded
    )
    item.contextValue = `group-${g.status}`
    return item
  }

  private getSessionItem(s: SessionState): vscode.TreeItem {
    const elapsedSec = Math.max(0, Math.floor(Date.now() / 1000) - s.stateChangedAt)
    const row = renderRowPresentation(s, elapsedSec, this.longWaitThresholdSec)

    const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None)
    item.iconPath = new vscode.ThemeIcon(row.iconId, new vscode.ThemeColor(row.iconColor))
    item.description = row.description
    item.tooltip = this.buildTooltip(s, elapsedSec)
    // 单击 / 双击 Session 行 → 在新窗口打开 (forceNewWindow:true),
    // 避免覆盖当前 workspace。
    // 想"接管当前窗口打开"的场景,通过右键菜单 "Open in Current Window" 显式触发。
    item.command = {
      command: 'vscode.openFolder',
      arguments: [vscode.Uri.file(s.cwd), { forceNewWindow: true }],
      title: 'Open in New Window'
    }
    // contextValue 区分 muted / unmuted,菜单 when 表达式据此控制 "Toggle Mute / Unmute" 标题
    // (VS Code 支持 when 表达式但不支持动态 label,所以命令只有一个,菜单固定显示 "Toggle")
    item.contextValue = s.muted === true ? `session-${s.status}-muted` : `session-${s.status}`
    return item
  }

  private buildTooltip(s: SessionState, elapsedSec: number): vscode.MarkdownString {
    const md = new vscode.MarkdownString()
    md.appendMarkdown(`**${path.basename(s.cwd) || s.cwd}** · ${statusLabel(s.status)} · ${humanizeDuration(elapsedSec)}\n\n`)
    md.appendMarkdown(`\`${s.cwd}\`\n\n`)
    if (s.lastUserPrompt) {
      // appendText 而非 appendMarkdown:用户输入含未信任 markdown 字符
      // ([](...)、![]() 等),appendMarkdown 不转义会渲染成可点链接 (08-29 R2)
      md.appendText(`Prompt: ${s.lastUserPrompt}\n\n`)
    }
    if (s.currentTool) {
      const input = typeof s.currentTool.input === 'object'
        ? JSON.stringify(s.currentTool.input)
        : String(s.currentTool.input)
      md.appendText(`Tool: ${s.currentTool.name} ${input}\n\n`)
    }
    md.appendMarkdown(`Session: \`${s.sessionId}\``)
    return md
  }
}