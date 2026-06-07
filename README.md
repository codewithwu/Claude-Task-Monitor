# Claude Task Monitor

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

从源码：

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
