# P2-14,16: 配置入口 + Welcome View 链接补全

## Goal

(a) Welcome View 加 `[Settings](command:workbench.action.openSettings,["claudeTaskMonitor"])` 跳转;(b) Welcome View 加 `[Install Hook](command:claudeTaskMonitor.installHook)` 和 `[View Docs](command:claudeTaskMonitor.openDocs)`;(c) 文案改成 "空列表引导到修复路径" 而不是陈述事实。

## Requirements

- Welcome View 文案重构:从"陈述事实"改为"问题 → 修复路径"
- 三个新命令链接:
  - `[Settings](command:workbench.action.openSettings,["claudeTaskMonitor"])` → 打开设置面板到本插件 section
  - `[Install Hook](command:claudeTaskMonitor.installHook)` → 调 installHookAssets
  - `[View Docs](command:claudeTaskMonitor.openDocs)` → 打开 `https://github.com/codewithwu/Claude-Task-Monitor#readme`
- 新增命令 `claudeTaskMonitor.openDocs`(vscode.env.openExternal)
- jq 缺失时 Welcome View 替换为 jq 安装引导 + `[Copy Command]` 链接
- Welcome View 文案分两段:基础信息(始终显示)+ 修复路径(根据 jq 状态切换)

## Acceptance Criteria

- [ ] Welcome View 三个链接全部可点击,执行对应命令
- [ ] settings 跳转精准到 claudeTaskMonitor section(不是 General)
- [ ] 空列表时用户能立刻看到"下一步做什么"
- [ ] jq 缺失分支有独立欢迎文案(不显示 hook 链接,改为 jq 安装链接)
- [ ] 单测覆盖 openDocs 调 vscode.env.openExternal

## Notes

- 父任务:[08-22-ux-optimization-roadmap](../08-22-ux-optimization-roadmap/)
- 与 P0-3/4(`ux-onboarding-rerunnable`)互补:那边建命令骨架,这边补 Welcome View 文案与分支
- `viewsWelcome.contents` 支持 markdown + command 链接(VS Code 1.72+)