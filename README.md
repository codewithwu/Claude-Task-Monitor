# Claude Task Monitor

[![Open VSX Version](https://img.shields.io/open-vsx/v/codewithwu-cn/claude-task-monitor)](https://open-vsx.org/extension/codewithwu-cn/claude-task-monitor)
[![GitHub Release](https://img.shields.io/github/v/release/codewithwu/Claude-Task-Monitor)](https://github.com/codewithwu/Claude-Task-Monitor/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

VS Code 扩展：在活动栏侧边栏实时监控本机所有 Claude Code CLI 会话的执行状态。

- 🟢 待命（idle）
- 🟡 运行中（running）
- 🔴 等待人工确认（waiting）

会话进入 🔴 时弹 VS Code 通知，点击通知或侧边栏条目可跳转到对应项目。

## 系统依赖

- VS Code ≥ 1.85
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
code --install-extension claude-task-monitor-0.1.0.vsix
# Cursor
cursor --install-extension claude-task-monitor-0.1.0.vsix
```

### 从源码构建（开发者）

```bash
pnpm install
pnpm build
pnpm package         # 生成 .vsix
code --install-extension claude-task-monitor-0.1.0.vsix
```

激活后扩展会自动：

1. 创建 `~/.claude-task-monitor/sessions/`
2. 写入 `~/.claude-task-monitor/hook.sh`
3. 把 hooks 块合并进 `~/.claude/settings.json`

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `claudeTaskMonitor.staleHours` | 24 | 文件 mtime 超过该值视为僵尸 |
| `claudeTaskMonitor.notifyDedupeSeconds` | 30 | 同 session 通知去重窗口 |
| `claudeTaskMonitor.refreshIntervalMs` | 1000 | 持续时间刷新间隔 |

## 卸载

VS Code 卸载扩展时会弹确认对话框，可同时移除 hook.sh 与 settings.json 中我们注入的条目。

## 开发

```bash
pnpm install
pnpm build
pnpm test                # 单元测试
pnpm test:integration    # 集成测试（会启动一个 VS Code 实例）
code --extensionDevelopmentPath=$(pwd)   # 调试
```

## 手动验收清单

发布前请把下面每条都跑一遍：

- [ ] 多窗口并发：开 3 个 CLI，分别处于 🟢 / 🟡 / 🔴 三态，侧边栏正确显示 3 行
- [ ] 通知防骚扰：同一会话短时间内 PreToolUse + 多个 Notification 事件，只弹一次通知
- [ ] 异常退出：`kill -9` 一个 CLI 进程，重启 VS Code 后该会话被归档进 `.ended/`
- [ ] 跳转：点击 🔴 条目，项目所在 VS Code 窗口被聚焦（如已开），或被新打开
- [ ] 持续时间：等待 1 分钟，描述里数字从 `30s` 滚到 `1m`
- [ ] 排序：🔴 永远在最前，同色按状态时间倒序
- [ ] 卸载：扩展卸载后 `~/.claude/settings.json` 中我们的条目消失，用户原有 hooks 保留

## 已知局限

- 不监控远程/SSH 机器上的 CLI
- 外部终端运行的 CLI 不能"聚焦到那个终端窗口"，只能开项目
- 没有历史/统计视图
