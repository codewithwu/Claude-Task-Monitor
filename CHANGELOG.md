# 更新日志 (Changelog)

本项目所有重要变更均记录于此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本 (SemVer)](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.3] - 2026-08-16

### Fixed

- **被 `strace` / `gdb` 附着的 Claude CLI 永远不被判定为已死**：`liveness.ts`
  `checkViaProc` 之前的正则 `\w+` 抓不到多词状态名 `t (tracing stop)`，且常量
  `'tracing_stop'`（下划线）与内核实际输出 `'tracing stop'`（空格）对不上；
  `checkViaPsFallback` / `checkViaWslOrTasklist` 的大小写敏感比较漏掉了
  `ps -o stat=` 对 ptrace'd 进程返回的小写 `t`。综合结果：任何被 `strace` /
  `gdb` 附着的 CLI 在 Linux / macOS / WSL2 三平台都无法被检测为 gone，违反
  spec 里"kill 用户无法交互的进程"的不变量。现在三个平台分支统一判定
  `c === 'T' || c === 't' || c === 'Z' || c === 'X'`（`T` 为 SIGSTOP，
  `t` 为 ptrace tracing-stop，二者 case 不同）。
- **`Notifier.lastNotifiedAt` Map 永久泄漏**：commit `c5266a8` 删除了
  `Notifier.reset(sessionId)`（"删除无调用方的 Notifier.reset"），但未在
  `store.removeByPid` 或 `store.apply` 的 SessionEnd 分支补回清理调用，
  导致 dedup 记录按总 session 数线性增长。重新引入 `Notifier.reset`，
  `SessionStore` 通过构造函数注入 `onSessionRemoved` 回调，在 SessionEnd
  和 `removeByPid` 时调用（未知 session 仍走 prev === null 短路，保持
  chokidar-unlink race 处理语义）。

### Docs

- `.trellis/spec/liveness.md` 重写：把 cross-platform process state code
  alphabet（R/S/D/I/T/t/Z/X）提到首位作为真理表，所有平台分支引用同一张表。
- 新增 "Notifier ↔ SessionStore Cleanup Wiring" 章节，记录 `Notifier.reset`
  的结构性角色（防止下次再有人因"无 caller"就删）。
- 新增 "Post-mortem: prevention checklist"，列出 6 项下次改 `liveness.ts` /
  `notifier.ts` 之前的必跑项（含 delete-API structural grep）。
- 顺带修 `.trellis/spec/testing.md:56` 的 `'tracing_stop'`（下划线，从未匹
  配任何东西）→ `'tracing stop'`（实际内核输出）。

### Testing

- 新增 12 个 vitest 用例：小写 `t`（win32 wsl.exe、darwin ps、linux `/proc`
  fallback）、多词状态名 `t (tracing stop)`（mocked `fs.readFileSync` + 
  `process.pid` 绕过 ESRCH 短路）、`Notifier.reset` 语义、SessionStore
  `onSessionRemoved` 触发规则（hit / miss / 未知 session / 向后兼容）。
- 单元测试总数：84 → 95。

[Unreleased]: https://github.com/codewithwu/Claude-Task-Monitor/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/codewithwu/Claude-Task-Monitor/compare/v0.1.2...v0.1.3

## [0.1.2] - 2026-08-16

### Fixed

- **WSL2 会话被误判为已死**：之前在 Windows 上跑扩展时，`process.kill(wslPid, 0)` 会抛
  `ESRCH`（Windows 进程表查不到 Linux PID），导致 5s 内所有 WSL2 内的 Claude 会话被全部
  误清空。现改为平台路由：Linux/WSL guest 走 `/proc/${pid}/status`，macOS 走 `ps`，Windows
  优先 `wsl.exe ps` 查 WSL2 PID，失败再降级到 `tasklist`。
- **纯 Windows 上死会话永远清不掉**：`/proc` 不存在、`ps` 又不在 PATH 时 catch 块返回
  `false`，导致 Ctrl+Z / 异常退出的 CLI 永久挂在侧边栏。`tasklist` 路径修复后正确识别。
- **prune 与 chokidar 抢同一会话的双重刷新**：`pruneDeadSessions` 归档后 `removeByPid` 触发
  一次 emit，几毫秒后 chokidar 的异步 `unlink` 事件派发合成 `SessionEnd` 又 emit 一次，
  N 个会话同时死时是一次 UI 重绘风暴。`apply` 现在对未知/已移除 session 的 SessionEnd
  和 reduce 返回 prev 引用本身（no-op）的 update 不再 emit。
- **`execSync` 字符串拼接注入风险**：`ps -o stat= -p ${pid}` 改为 `execFileSync('ps', [...])`
  走数组参数，畸形 PID 不再被 shell 解释。
- **归档文件名同秒撞名**：`hook.sh` 路径用 `$(date +%s)`、TS 路径用 `Date.now()`，同秒内
  多次归档会互相覆盖。两边都加了唯一后缀（hook.sh 用 `$$`，TS 用 `randomUUID` 切片）。
- **prune 循环里 `mkdirSync` 反复 stat**：N 个死会话对应 N 次 mkdir 系统调用。提到循环外。
- **激活时泄漏 session ID 前缀到 DevTools Console**：删掉两行 `console.log`。

### Changed

- 删除无调用方的 `Notifier.reset` 方法（死代码）。

### Testing

- 新增 platform-routing 单元测试（win32 优先 `wsl.exe` 再 `tasklist`、两者都失败时不误杀）
- 新增非整数 PID（NaN / 0 / 负数 / 小数）健壮性测试
- 新增 `apply` no-op 不 emit 的 6 条断言
- 新增 `pruneDeadSessions` 幂等性测试
- 新增 `hook.sh` SessionEnd 归档文件名包含 PID 后缀的断言
- 单元测试总数：75 → 84

[0.1.2]: https://github.com/codewithwu/Claude-Task-Monitor/releases/tag/v0.1.2
[0.1.1]: https://github.com/codewithwu/Claude-Task-Monitor/releases/tag/v0.1.1
[0.1.0]: https://github.com/codewithwu/Claude-Task-Monitor/releases/tag/v0.1.0

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
