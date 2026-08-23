# <img src="./resources/icons/icon.png" width="48" alt="Claude Task Monitor icon" style="vertical-align: middle;"> Claude Task Monitor

[![Open VSX Version](https://img.shields.io/open-vsx/v/codewithwu-cn/claude-task-monitor)](https://open-vsx.org/extension/codewithwu-cn/claude-task-monitor)
[![GitHub Release](https://img.shields.io/github/v/release/codewithwu/Claude-Task-Monitor)](https://github.com/codewithwu/Claude-Task-Monitor/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

VS Code 扩展：在活动栏侧边栏实时监控本机所有 Claude Code CLI 会话的执行状态。

- 🟢 待命（idle）
- 🟡 运行中（running）
- 🔴 等待人工确认（waiting）
- 🚨 长时间等待（waiting，超过配置阈值）

会话进入 🔴 时弹出 VS Code 通知。点击通知或 Session 条目可跳转到对应项目；需要保留多个并行任务的上下文时，可在独立窗口中打开项目。

## 主要功能

- **实时状态监控**：在活动栏侧边栏显示所有本地 Claude Code 会话，并持续刷新状态和持续时间
- **等待提醒**：waiting 会话触发系统通知、侧边栏徽标和状态栏告警；支持逐条、聚合或静默模式
- **快速定位**：点击 Session 跳转到项目；支持在独立窗口、当前窗口、内置终端或集成终端中打开
- **分组与过滤**：按 Running / Waiting / Idle 分组，并可从状态栏快速切换过滤条件
- **会话管理**：支持置顶、临时静音、复制 Session ID / JSON、查看原始文件、归档和重新安装 hook
- **中英文 UI**：通过状态栏的 🌐 按钮在 Auto / 中文 / English 之间切换；Command Palette 和 VS Code 视图标题仍跟随 VS Code 显示语言
- **长等待告警**：waiting 超过指定时间后使用高优先级告警图标，便于在会话列表中快速发现
- **异常退出检测**：自动处理进程退出、Ctrl+Z、崩溃等情况，避免僵尸会话长期占用列表
- **快捷入口**：`Shift+Cmd+C`（macOS）或 `Shift+Ctrl+C`（Windows / Linux）聚焦 Session 视图

> Command Palette 可执行 `Claude Task Monitor: Switch UI Language (Auto / 中文 / English)`，效果与状态栏 🌐 按钮相同。

## 设计初心

用 Claude Code 干活，**并行是常态**：一个终端在改 API，一个在跑数据迁移，
一个在重构旧模块。你的屏幕前同时跑着 3～5 个 `claude` 进程。

问题在于：**你的注意力一次只能在一个窗口里**。当 A 任务正在刷出长长的
日志，B 任务在某个 `rm -rf` 或者 `git push --force` 之前停下来等你点确认
——你**完全没看见**。它不会失败，不会报错，不会自动重试，只是安静地
挂在那里，等你什么时候想起来切回去。

等你切回去的时候，已经过去十分钟、二十分钟、半小时。
一段本该是<em>人机协作</em>的工作流，被迫降级成了<em>轮询</em>。

**Claude Task Monitor 就是为了消除这种「背后的等待」而生的。**
把每一个本地 Claude Code 会话的执行状态，以颜色、图标和通知实时投射到
你日常使用的 IDE 侧边栏——你不需要切窗口、不需要 `tmux switch`、
不需要 `ls ~/.claude/projects/`。余光里看到一颗红点，就知道那边
有个任务正在等你。

## 系统依赖

- VS Code ≥ 1.86
- Claude Code CLI
- `jq`（macOS: `brew install jq`，Debian/Ubuntu: `apt install jq`）
- `bash`

## 安装

扩展已发布到 [Open VSX](https://open-vsx.org/extension/codewithwu-cn/claude-task-monitor)；
[GitHub Releases](https://github.com/codewithwu/Claude-Task-Monitor/releases) 同步提供 `.vsix` 离线包。

不同 IDE 使用不同的扩展市场，请按你使用的 IDE 选对应方式：

### VSCodium / Code - OSS / Gitpod

这些 IDE 默认使用 Open VSX。打开扩展面板，搜索 `claude-task-monitor`，点 Install 即可。

### VS Code / Cursor / Windsurf

这些 IDE 使用自家扩展市场，不直接连 Open VSX。安装步骤：

1. 到 [Releases](https://github.com/codewithwu/Claude-Task-Monitor/releases) 下载最新的 `claude-task-monitor-X.Y.Z.vsix`
2. 在 IDE 里打开命令面板（`Ctrl+Shift+P` / `Cmd+Shift+P`）
3. 运行 **"Extensions: Install from VSIX"**，选中下载的 `.vsix` 文件

或者在终端里：

```bash
# VS Code
code --install-extension claude-task-monitor-0.3.0.vsix
# Cursor
cursor --install-extension claude-task-monitor-0.3.0.vsix
```

### 从源码构建（开发者）

```bash
pnpm install
pnpm build
pnpm package         # 生成 .vsix
code --install-extension packages/claude-task-monitor-0.3.0.vsix
```

激活后扩展会自动：

1. 创建 `~/.claude-task-monitor/sessions/`
2. 写入 `~/.claude-task-monitor/hook.sh`
3. 把 hooks 块合并进 `~/.claude/settings.json`

如果未检测到 `jq`，扩展会暂停 hook 安装并提示依赖命令；安装完成后重启 VS Code 即可继续。

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `claudeTaskMonitor.staleHours` | `24` | 文件 mtime 超过该小时数视为僵尸，并归档到 `.ended/` |
| `claudeTaskMonitor.notifyDedupeSeconds` | `30` | 同一 session 的通知去重窗口 |
| `claudeTaskMonitor.refreshIntervalMs` | `1000` | 侧边栏持续时间的刷新间隔（毫秒） |
| `claudeTaskMonitor.livenessCheckIntervalMs` | `5000` | 进程活性检测间隔；用于把 Ctrl+Z / 异常退出的 CLI 从侧边栏移除 |
| `claudeTaskMonitor.notifyMode` | `aggregate` | 等待通知模式：`all` 逐条通知、`aggregate` 合并通知、`silent` 仅更新状态栏和徽标 |
| `claudeTaskMonitor.defaultFilter` | `all` | 侧边栏默认过滤条件：`all` / `running` / `waiting` / `idle` |
| `claudeTaskMonitor.longWaitingThresholdSec` | `300` | waiting 超过该秒数后显示高优先级告警图标 |
| `claudeTaskMonitor.language` | `auto` | UI 语言：`auto` 跟随 VS Code，`zh` 强制中文，`en` 强制英文 |

旧的 `claudeTaskMonitor.notifyAggregateMode` 配置仍兼容已有设置；如需调整通知行为，请使用 `claudeTaskMonitor.notifyMode`。

## 卸载

VS Code 卸载扩展时会弹确认对话框，可同时移除 hook.sh 与 settings.json 中我们注入的条目。扩展卸载不会删除已产生的 Session 文件。

## 开发

```bash
pnpm install
pnpm build
pnpm test                # 单元测试
pnpm test:integration    # 集成测试（会启动一个 VS Code 实例）
code --extensionDevelopmentPath=$(pwd)   # 调试
```

## 手动测试清单

发布前请把下面每条都跑一遍：

- [ ] 多窗口并发：开 3 个 CLI，分别处于 🟢 / 🟡 / 🔴 三态，侧边栏正确显示 3 行
- [ ] 状态分组与过滤：Session 按状态分组，状态栏过滤条件切换后列表立即更新，置顶项始终在对应组最前
- [ ] 长等待告警：将 `longWaitingThresholdSec` 调低，waiting 行的图标立即切换为告警样式；恢复设置后也无需 reload
- [ ] 通知防骚扰：同一会话短时间触发 PreToolUse + 多个 Notification 事件，去重窗口内只弹一次通知
- [ ] 通知模式：分别验证 `all`、`aggregate`、`silent`；聚合/静默模式下状态栏和徽标仍正确更新
- [ ] 异常退出：向一个 CLI 发送 Ctrl+Z / `kill -9`，侧边栏显示退出或验证状态，确认死亡后归档进 `.ended/`
- [ ] 跳转：点击 🔴 条目，验证独立窗口、当前窗口和集成终端打开方式；外部终端仍只打开项目
- [ ] 会话操作：验证复制 ID / JSON、置顶、临时静音、查看原始文件、归档和重新安装 hook
- [ ] 持续时间：等待 1 分钟，描述里数字从 `30s` 滚到 `1m`
- [ ] 语言切换：点击状态栏 🌐，在 Auto / 中文 / English 间循环，状态栏、侧边栏、Toast 和通知立即刷新；重启后偏好仍保留
- [ ] 快捷键：验证 `Shift+Cmd+C`（macOS）和 `Shift+Ctrl+C`（Windows / Linux）聚焦 Session 视图
- [ ] 缺少 `jq`：在 PATH 中临时隐藏 `jq`，扩展提示依赖错误且不写入 hook；恢复后重启 VS Code 可正常安装
- [ ] 卸载：扩展卸载后 `~/.claude/settings.json` 中我们的条目消失，用户原有 hooks 保留

## 已知局限

- 不监控远程/SSH 机器上的 CLI
- 外部终端运行的 CLI 不能“聚焦到那个终端窗口”，只能打开项目
- `language` 不会覆盖由 VS Code 直接管理的 Command Palette 和视图标题
- 没有历史/统计视图
