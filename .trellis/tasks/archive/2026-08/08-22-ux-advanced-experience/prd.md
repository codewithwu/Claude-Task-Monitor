# P2-17,18: 高级体验 (liveness 视觉反馈 / 多窗口通知路由)

## Goal

(a) liveness 检测到进程死亡后,sidebar 行短暂闪烁/strikethrough 2s 再移除,避免误以为 CLI 还活着;(b) 通知路由:把 waiting 通知送到产生该 session 的最近活跃窗口(避免 Window A 触发、Window B 看不到桌面通知);需先实测确认现状再设计。

## Requirements

- **(a) Liveness 视觉反馈**:
  - SessionState 加 `dyingAt?: number`(liveness.ts 检测到进程死亡时设置)
  - `renderRowPresentation` 检测 `dyingAt`,在 description 加 strikethrough / icon 换 `circle-slash`
  - 设置 `dyingAt` 后 2s 真正从 store 移除(setTimeout 在 store.apply 内调度)
  - 单测覆盖 dying 状态渲染分支
- **(b) 多窗口通知路由**(需 design.md 阶段先实测):
  - 实测确认当前 `vscode.window.showWarningMessage` 在两个 VS Code 窗口下行为:全局桌面通知 / 仅当前窗口 / 仅活跃窗口
  - 根据实测结果设计:
    - 现状是全局:接受现状,只加 tooltip 说明
    - 现状是单窗口:把通知分发改成"在最近活跃窗口内执行"
  - session-to-window 映射方案:workspaceState 保存 cwd 最近 mtime 的 windowId

## Acceptance Criteria

- [ ] (a) Ctrl+Z 杀 CLI 后 sidebar 行有 2s 视觉提示(strikethrough / 图标换 circle-slash)再消失
- [ ] (a) dying 状态期间 tooltip 文案带"(已退出,即将移除)"
- [ ] (b) 实测报告记录在 design.md(全局 vs 单窗口 vs 活跃窗口)
- [ ] (b) 如果需要路由:双窗口场景,Window A 触发的 waiting 通知只在 Window A 出现
- [ ] 单测覆盖 dying 渲染分支

## Notes

- 父任务:[08-22-ux-optimization-roadmap](../08-22-ux-optimization-roadmap/)
- **(b) 必须先 design.md 实测再实现**,否则可能做无用功
- 两件事可分别验收,建议分两个 commit
- 影响:`liveness.ts` + `types.ts` + `rowPresentation.ts` + (可能)`notifier.ts` / `extension.ts`