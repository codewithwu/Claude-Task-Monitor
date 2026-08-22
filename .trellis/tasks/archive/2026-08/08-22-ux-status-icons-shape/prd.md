# P1-7: 状态图标形状差异化 (色盲友好)

## Goal

`rowPresentation.ts:42-51` 三个状态都用 `circle-filled` 仅换色,色盲用户无法区分。改为:waiting=circle-filled 红 / 长等=alert error;running=sync~spin 黄(旋转动画);idle=circle-outline 灰。形状 + 颜色双编码。

## Requirements

- waiting 短等:`circle-filled` + `charts.red`
- waiting 长等(≥ 阈值):`alert` + `errorForeground`
- running:`sync~spin` + `charts.yellow`(内置动画 codicon,sidebar 中可见旋转)
- idle:`circle-outline` + `descriptionForeground`(比 charts.green 更克制)
- 长等阈值与 P1-8 任务共享配置 `claudeTaskMonitor.longWaitingThresholdSec`(默认 300 秒),避免重复定义

## Acceptance Criteria

- [ ] 四个状态视觉上形状不同(不仅颜色)
- [ ] running 的 spin 动画在 sidebar 可见(肉眼可验证)
- [ ] 色盲用户(模拟:灰度截图)能通过形状区分状态
- [ ] 单测断言 `iconId` 字段:waiting=`circle-filled`,waiting 长等=`alert`,running=`sync~spin`,idle=`circle-outline`
- [ ] tooltip 文案同步更新颜色提示(避免失去语义信息)

## Notes

- 父任务:[08-22-ux-optimization-roadmap](../08-22-ux-optimization-roadmap/)
- 涉及 `util/rowPresentation.ts:42-51`
- `sync~spin` 是 VS Code 内置 codicon,需要 ThemeIcon 支持 animation(1.86+ 已有,已在 engines 内)
- 与 P1-8 长等阈值任务合并,避免两边各自硬编码