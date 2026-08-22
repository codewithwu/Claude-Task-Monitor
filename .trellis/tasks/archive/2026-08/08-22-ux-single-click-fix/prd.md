# P0-1: 修复 Session 行单击破坏当前 workspace

## Goal

`treeDataProvider.ts:37-41` 单击 Session 行 = `vscode.openFolder` + `forceNewWindow:false`,会替换当前工作区,导致用户瞄一眼状态就丢上下文。改成打开新窗口 / 单击只选中 + 双击打开 / 移除单击命令(放右键菜单)三选一,需在 PRD 里给推荐方案。

## Requirements

- **采用方案 B**(`item.command` 保留但 `forceNewWindow:true`):最小代码改动,消除"单击破坏当前 workspace"风险,同时保留"一点就开"的体感
- 单击 / 双击 Session 行 → `vscode.openFolder(forceNewWindow:true)`,**打开新窗口**不破坏当前
- 右键菜单新增 `Open in Current Window` 命令(`forceNewWindow:false`),给确实想换 workspace 的用户提供显式入口(原默认行为降级为 opt-in)
- `item.command.title` 改为 `Open in New Window`(tooltip 默认展示给用户)
- 现有 tooltip / icon / description 行为不变

## Acceptance Criteria

- [ ] 单击 Session 行**不会**替换当前 workspace(改为新窗口打开)
- [ ] 双击 Session 行也是新窗口打开(不会开 2 个新窗口,因为是同 command 重触发)
- [ ] 右键菜单有 `Open in New Window`(隐含,因为单击已经走这个)和 `Open in Current Window`(新加)
- [ ] `forceNewWindow:true` 是默认安全行为
- [ ] `package.json` menus 加 `Open in Current Window` 项
- [ ] 手动验证:多 workspace 下单击不丢当前 workspace
- [ ] 现有 142 用例不破(`pnpm test`)

## Notes

- 父任务:[08-22-ux-optimization-roadmap](../08-22-ux-optimization-roadmap/)
- hot spot:`treeDataProvider.ts:37-41`
- 与 P2-11/12(`ux-shortcuts-contextmenu` 中"Open in New Window"右键菜单)联动,本任务先把骨架建好,详细右键菜单项在那边补全
- 改动 ~30 行, 影响范围小,建议作为第一个 P0 实现