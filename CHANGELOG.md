# 更新日志 (Changelog)

本项目所有重要变更均记录于此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本 (SemVer)](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.1] - 2026-06-08

### Fixed

- 替换扩展图标：从空 PNG 改为基于 `sidebar.svg` 渲染的 428×428 dashboard 图标（5 根柱状图）

## [0.1.0] - 2026-06-08

首个公开版本。提供 Claude Code CLI 会话的本地实时监控。

### Added

- 活动栏侧边栏：实时显示所有本地 Claude Code CLI 会话及三态徽标
  - 🟢 待命 (idle)
  - 🟡 运行中 (running)
  - 🔴 等待人工确认 (waiting)
- 🔴 状态时弹出 VS Code 通知，点击通知或侧边栏条目可跳转到对应项目
- 会话持续时间滚动显示（`30s` → `1m` → `2m`...）
- 智能排序：🔴 永远置顶，同色按状态变更时间倒序
- Hook 机制：扩展首次激活时自动将 `~/.claude-task-monitor/hook.sh` 与
  `~/.claude/settings.json` 中的 hooks 块合并，对用户已有 hooks 保持幂等
- 会话活性检测：通过 PID 活性检查把 `kill -9`、SIGSTOP、僵尸等异常退出的
  CLI 从侧边栏移除，并把对应 `.jsonl` 归档到 `~/.claude-task-monitor/sessions/.ended/`
- 配置项（VS Code Settings）：
  - `claudeTaskMonitor.staleHours`（默认 24）：文件 mtime 超过该小时数视为僵尸
  - `claudeTaskMonitor.notifyDedupeSeconds`（默认 30）：同 session 通知去重窗口
  - `claudeTaskMonitor.refreshIntervalMs`（默认 1000）：侧边栏持续时间刷新间隔
  - `claudeTaskMonitor.livenessCheckIntervalMs`（默认 5000）：进程活性检测间隔
- 卸载时弹确认对话框，可同时移除注入的 `hook.sh` 与 `settings.json` 条目
- 自定义侧边栏图标与扩展图标

### Fixed

- Hook 启动时沿进程树向上查找 comm 为 `claude` 的 durable PID，避免被
  `PPID` 的瞬时值误导
- 首次添加会话时保留 watcher offset，避免重复读取已处理过的 JSONL 行
- 集成测试中 `ours` 类型在 `tsc --noEmit` 下过宽，缩窄类型
- 进程活性检测：识别 SIGSTOP 暂停与僵尸状态，prune 时归档 `.jsonl`

### Testing

- 集成测试：使用 `@vscode/test-electron` 启动真实 VS Code 实例
- 端到端活性检测：起真实子进程，覆盖 `kill -9` / SIGSTOP / 正常退出三种路径
- 单元测试：事件 reducer、SessionStore、installer、watcher 等核心模块

[Unreleased]: https://github.com/codewithwu/Claude-Task-Monitor/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/codewithwu/Claude-Task-Monitor/releases/tag/v0.1.1
[0.1.0]: https://github.com/codewithwu/Claude-Task-Monitor/releases/tag/v0.1.0
