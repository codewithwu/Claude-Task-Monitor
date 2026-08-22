# P2-11,12,13: 快捷键 + 右键菜单补全 + 命令面板可用性

## Goal

(a) keybindings 加 cmd/ctrl+shift+c focus sessions view;(b) 右键菜单新增 Open in New Window / Mark as Resolved / View Session File / Pin to Top;(c) 给现有 CopySessionId/Archive 等命令加 *OnSelected 无参版,从 treeView.selection 拿选中项,Command Palette 可搜。

## Requirements

- `keybindings` 新增:`cmd+shift+c`(mac) / `ctrl+shift+c`(其他)→ `claudeTaskMonitor.focusSessionsView`
- 新增命令:`claudeTaskMonitor.openInNewWindow`(forceNewWindow:true)/ `claudeTaskMonitor.markAsResolved`(归档 + 从 store 移除)/ `claudeTaskMonitor.viewSessionFile`(revealFileInOS 到 .jsonl)/ `claudeTaskMonitor.togglePin`(给 SessionState 加 pinned 字段,排序置顶)
- 每个原命令复制 *OnSelected 版,无参:`treeView.selection[0]` 取 SessionState
  - copySessionIdOnSelected / copyAsJsonOnSelected / openInTerminalOnSelected / revealInExplorerOnSelected / archiveSessionOnSelected
- Command Palette 标题改为 "Copy Session ID (Selected)" 等便于搜索
- 右键菜单 `menus.view/item.context` 加新命令的 `when: "view == claudeTaskMonitor.sessionsView"`
- pinned 排序:session 列表渲染时,pinned=true 的项置顶(分组内也置顶)

## Acceptance Criteria

- [ ] keybinding 实际工作(测试 Cmd+Shift+C focus sidebar)
- [ ] 右键菜单新增 4 项可见可执行
- [ ] Command Palette 搜 "Copy Session ID" 可见并对当前焦点行生效
- [ ] pinned session 在 sidebar 列表中置顶
- [ ] 现有 5 个右键菜单行为不变
- [ ] 单测覆盖 *OnSelected 从 selection 取 SessionState 的逻辑

## Notes

- 父任务:[08-22-ux-optimization-roadmap](../08-22-ux-optimization-roadmap/)
- 与 P0-1(`ux-single-click-fix`)联动:单击行为改了之后,"Open in New Window" 是 fallback 入口
- *OnSelected 命令无 contextValue 也能从 selection 拿,但要注意 treeView.selection 为空时的 fallback