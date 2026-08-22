# P0-2: Session 列表分组与过滤

## Goal

`getChildren()` 直接平铺 `store.list()`,session 多时找不到重点。引入按状态分组(Waiting/Running/Idle)+ 顶部 inline filter(All/Waiting/Running/Idle),通过 TreeView 嵌套或 commands.when 控制。

## Requirements

- 推荐方案:TreeView 嵌套(顶层 Group 节点:Waiting(N)/Running(N)/Idle(N),下层 SessionState),分组自带徽标数
- 备选:保持平铺,view title 加 inline button(filter 命令),`commands.when` 切换可见性
- filter 状态保存到 `context.workspaceState`,跨重启保留
- 新增配置 `claudeTaskMonitor.defaultFilter`,默认 `all`
- 空组不显示(Waiting=0 时不渲染该 group)

## Acceptance Criteria

- [ ] sidebar 顶层是分组节点(Waiting / Running / Idle),每组前缀带计数
- [ ] 点 group 折叠/展开正常
- [ ] 8+ session 时仍能一眼定位 waiting
- [ ] filter 切换不需重启 VS Code
- [ ] filter 状态跨窗口保留(workspaceState)
- [ ] 空组不渲染(避免视觉噪音)

## Notes

- 父任务:[08-22-ux-optimization-roadmap](../08-22-ux-optimization-roadmap/)
- 与 P1-7(`ux-status-icons-shape`)协同:分组后每组徽标更直观
- 改动核心:`treeDataProvider.ts` 的 `getTreeItem` / `getChildren` + 新增 Group 节点类型
- 数据量大时性能考虑:每次 refresh 重新构造,已有 store.onChange 触发,可复用