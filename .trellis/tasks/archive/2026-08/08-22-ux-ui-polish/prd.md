# P1-8,9,10: UI 细节打磨 (长等阈值配置 / status bar 信息密度 / activitybar 二态)

## Goal

三件事:(a) `LONG_WAITING_THRESHOLD_SEC` 提到配置 `longWaitingThresholdSec`;(b) status bar hover tooltip 展示前 N 个 waiting 项目名 + 时长;(c) activitybar sidebar.svg 做两态 SVG 或靠 badge 颜色区分。

## Requirements

- 新增配置 `claudeTaskMonitor.longWaitingThresholdSec`,默认 300(秒),与现有 `LONG_WAITING_THRESHOLD_SEC = 5 * 60` 对齐
- `util/rowPresentation.ts` 的 `LONG_WAITING_THRESHOLD_SEC` 改为函数参数(从 caller 注入 cfg 值)
- `extension.ts` 激活时读取 cfg,传给 `renderRowPresentation`
- `util/statusBarContent.ts` 新增 `formatWaitingTooltip(sessions, limit=3)`:展示前 3 个 waiting 项目名 + 时长,多余用 "等 N 个"
- status bar `tooltip` 改为调用上述函数
- activitybar:`resources/icons/sidebar.svg` 拆 waiting/idle 两态,或靠 `treeView.badge` 颜色 + sidebar 文字 "Waiting" 已能区分,不强求 SVG 二态(选性价比方案)

## Acceptance Criteria

- [ ] 配置阈值修改后立即生效(无需重启)
- [ ] status bar hover 显示 "project-a 1m, project-b 5m" 形式
- [ ] status bar tooltip 不撑爆(最长截断)
- [ ] activitybar 在 waiting=0 和 waiting≥1 时视觉可区分
- [ ] 单测覆盖 `formatWaitingTooltip` 边界(0/1/3/>3 个 waiting)
- [ ] 与 P1-7(`ux-status-icons-shape`)共用同一份 cfg 读取,无重复

## Notes

- 父任务:[08-22-ux-optimization-roadmap](../08-22-ux-optimization-roadmap/)
- status bar 信息密度提升后,用户不展开 sidebar 也能知道"哪几个项目在等"
- 二态 SVG 工作量大,建议先靠 badge 传达,设计稿确认后再做 SVG