# P0-3,4: Onboarding 可重入 + jq 缺失引导改造

## Goal

`onboarding.ts:29` `hasSeenOnboarding` 永久标记,跳过后无入口重看。改造:(a) 提供命令 `claudeTaskMonitor.showOnboarding` + `claudeTaskMonitor.installHook` 走 Command Palette;(b) Welcome View 加可点击命令链接;(c) jq 缺失时 TreeView.message 常驻 warning banner,而不是一闪而过的 toast。

## Requirements

- 新增命令 `claudeTaskMonitor.showOnboarding`(Command Palette 标题 "Claude Task Monitor: Show Onboarding"),无视 globalState 强制重弹
- 新增命令 `claudeTaskMonitor.installHook`,内部调 `installHookAssets`(复用现有逻辑)
- 新增命令 `claudeTaskMonitor.copyJqInstallCommand`(按 OS 选 brew/apt/winget)
- Welcome View `viewsWelcome.contents` 加命令链接:`[Install Hook]` / `[Open Settings]` / `[Show Onboarding]`
- jq 缺失时:`treeView.message` 设置为 warning 文字 + 复制命令按钮(常驻直到下次激活重检 jq)
- 每次 `activate` 时重跑 `detectJq`,状态变化时刷新 `treeView.message`
- 保留 `maybeShowOnboarding` 首次弹窗逻辑,但 `showOnboarding` 命令复用同一份渲染函数

## Acceptance Criteria

- [ ] Command Palette 搜 "Show Onboarding" 可见可执行
- [ ] Welcome View 链接全部可点击,执行对应命令
- [ ] jq 缺失时 sidebar 顶部有常驻 banner,直到 jq 装好重启
- [ ] onboarding 状态不再只靠 globalState(`showOnboarding` 命令不读 globalState)
- [ ] uninstall hook 后 Welcome View 仍能引导重装
- [ ] 单测覆盖 `showOnboarding` 复用渲染函数

## Notes

- 父任务:[08-22-ux-optimization-roadmap](../08-22-ux-optimization-roadmap/)
- 与 P2-14/16(`ux-config-welcome-entries`)互补:本任务建命令骨架,那边补 Welcome View 文案
- `treeView.message` 是 VS Code 1.66+ API,已经在 engines 内