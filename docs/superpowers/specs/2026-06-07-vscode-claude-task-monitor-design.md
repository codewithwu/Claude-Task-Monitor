# VS Code 扩展：Claude Code 任务实时监控仪表盘

**日期**：2026-06-07
**状态**：Design

## 1. 目的与范围

在 VS Code 活动栏侧边栏提供一个实时仪表盘，列出本机当前所有正在运行的 Claude Code CLI 会话，并通过 🟢/🟡/🔴 三色状态指示每个会话所处的执行阶段。核心目标是解决"Claude Code 卡在等待人工权限确认时被遗忘"这一痛点。

### 用户痛点

用户在使用 Claude Code CLI 时，有些工具调用需要人工二次确认才会执行。当用户同时开了多个 CLI 窗口、或切走去做别的事，常常会忘记某个窗口正在等他点确认，导致任务长时间停在那里不前进。

### 目标

- 用户开 VS Code 即可一眼看到本机所有 Claude Code CLI 会话的健康状态
- 任意一个会话进入"等待人工确认"状态时，立即在 VS Code 内弹通知提醒
- 用户能从仪表盘快速跳转到对应会话所在项目

### 非目标（v1 不做）

- 不做远程/SSH 机器上 CLI 的监控（仅本机）
- 不做历史会话查询（仅当前实时活跃会话）
- 不做 cost/token 统计
- 不做声音、系统级桌面通知、状态栏徽标（仅 VS Code 内部通知）
- 不做会话级操作（不能在仪表盘里点"批准/拒绝"权限）

## 2. 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│  Claude Code CLI (多个窗口实例)                                │
│  每个窗口启动后, hooks 会触发以下事件写文件:                     │
│   SessionStart / UserPromptSubmit / PreToolUse /              │
│   PostToolUse / Notification / Stop / SessionEnd              │
└──────────────────────────────┬───────────────────────────────┘
                               │ (每次事件 jq -c >>)
                               ▼
        ~/.claude-task-monitor/sessions/<session-id>.jsonl
                               │
                               │ chokidar watch
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  VS Code 扩展                                                  │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────┐   │
│  │FileWatcher  │──▶│ StateManager │──▶│ TreeDataProvider │──▶ Side panel UI
│  └─────────────┘   └──────┬───────┘   └──────────────────┘   │
│                           │                                   │
│                           ▼                                   │
│                    ┌──────────────┐                           │
│                    │ Notifier     │──▶ VS Code 弹窗            │
│                    └──────────────┘                           │
└──────────────────────────────────────────────────────────────┘
```

四个内部模块：

- **FileWatcher**：监听 `sessions/` 目录的新增/修改/删除，把变化推给 StateManager
- **StateManager**：内存里维护 `Map<sessionId, SessionState>`，根据事件流推导状态
- **TreeDataProvider**：把 `SessionState[]` 渲染成 VS Code 侧边栏 tree
- **Notifier**：状态转 🔴 时弹通知，带短时间去重

## 3. 数据层

### 目录结构

```
~/.claude-task-monitor/
├── hook.sh                          # 扩展自动写入的统一 hook 入口
└── sessions/
    ├── <session-id-1>.jsonl         # 活跃会话
    ├── <session-id-2>.jsonl
    └── .ended/                      # SessionEnd 后移到这里, 24h 后清理
```

设计取舍：**一会话一文件**。优势：
- 避免多个 CLI 并发写同一文件的锁/竞态问题
- 文件存在即会话活跃，删除/移走即会话结束——天然的生命周期信号
- watcher 的 `add` / `change` / `unlink` 事件可直接映射到业务语义

### Hook 配置

扩展激活时把以下块幂等合并进 `~/.claude/settings.json`（已存在则跳过；新写入的块带 `"_owner": "claude-task-monitor"` 元字段，方便卸载时识别）：

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "~/.claude-task-monitor/hook.sh" }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "~/.claude-task-monitor/hook.sh" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "~/.claude-task-monitor/hook.sh" }] }],
    "PreToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "~/.claude-task-monitor/hook.sh" }] }],
    "PostToolUse":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "~/.claude-task-monitor/hook.sh" }] }],
    "Notification":     [{ "hooks": [{ "type": "command", "command": "~/.claude-task-monitor/hook.sh" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "~/.claude-task-monitor/hook.sh" }] }]
  }
}
```

### `hook.sh`（扩展自动生成并 `chmod +x`）

```bash
#!/usr/bin/env bash
set -e
dir="$HOME/.claude-task-monitor/sessions"
mkdir -p "$dir"
payload=$(cat)
session_id=$(echo "$payload" | jq -r '.session_id // empty')
event=$(echo "$payload" | jq -r '.hook_event_name // empty')
[ -z "$session_id" ] && exit 0
[ -z "$event" ] && exit 0

echo "$payload" | jq -c '. + {ts: now}' >> "$dir/$session_id.jsonl"

if [ "$event" = "SessionEnd" ]; then
  mkdir -p "$dir/.ended"
  mv "$dir/$session_id.jsonl" "$dir/.ended/$session_id-$(date +%s).jsonl" 2>/dev/null || true
fi
```

### 文件中的事件行示例

```jsonl
{"hook_event_name":"SessionStart","session_id":"abc-123","cwd":"/home/cooper/projects/api","source":"startup","ts":1733400000}
{"hook_event_name":"UserPromptSubmit","session_id":"abc-123","user_prompt":"修复登录接口的 token 过期问题","ts":1733400015}
{"hook_event_name":"PreToolUse","session_id":"abc-123","tool_name":"Bash","tool_input":{"command":"npm run deploy"},"ts":1733400020}
{"hook_event_name":"Notification","session_id":"abc-123","notification_type":"permission_prompt","ts":1733400021}
```

## 4. 状态推导

每个会话在内存里维护：

```ts
type SessionState = {
  sessionId: string
  cwd: string
  status: 'idle' | 'running' | 'waiting'   // 🟢 / 🟡 / 🔴
  stateChangedAt: number                   // 用于计算持续时间
  lastUserPrompt: string                   // 截断到 ~60 字符
  currentTool: { name: string, input: unknown } | null
  fileOffset: number                       // 增量读取游标
}
```

### 事件 → 状态转换表

| 事件 | 状态变化 | 副作用 |
|---|---|---|
| `SessionStart` | → 🟢 idle | 创建 session，记录 cwd |
| `UserPromptSubmit` | → 🟡 running | 更新 `lastUserPrompt`（截断到 60 字符） |
| `PreToolUse` | → 🟡 running | 记录 `currentTool = { name, input }` |
| `Notification`（`notification_type === "permission_prompt"`） | → 🔴 waiting | 保留 `currentTool` 作为挂起工具 |
| `Notification`（其他类型） | 无 | 忽略 |
| `PostToolUse` | → 🟡 running | 清空 `currentTool` |
| `Stop` | → 🟢 idle | 清空 `currentTool` |
| `SessionEnd` | 删除 session 条目 | 从 Map 移除，UI 移除该 tree item |

**`stateChangedAt` 更新规则**：仅当 `newStatus !== oldStatus` 时重置为当前时间。同状态内的重复事件（例如 🔴 期间又来一条 `Notification`）不重置，否则"持续时间"会被回弹，等待时间被低估。

### 正常流程示例

```
SessionStart           (🟢)
UserPromptSubmit       (🟡)
PreToolUse Bash        (🟡, tool=Bash:cmd)
Notification: permission_prompt  (🔴)   ← 用户不点确认时停在这里
  ... 用户长时间不响应 → 持续 🔴，触发 VS Code 通知
PostToolUse Bash       (🟡)
Stop                   (🟢)
```

注意：当用户不确认时 `PostToolUse` 永远不会触发，状态自然停留在 🔴——这正是产品要捕捉的核心场景。

### 通知触发

状态从 `idle` 或 `running` 变为 `waiting` 时，立即调用 `vscode.window.showWarningMessage` 弹通知。通知文案：`"<cwd 的 basename> 正在等待权限确认：<tool name>"`，附带 `"打开项目"` 按钮直接调起跳转。

防骚扰：同一 session 在 `notifyDedupeSeconds`（默认 30s）内不重复弹。

### 持续时间显示

`description` 字段显示 `now - stateChangedAt` 的人类可读形式（`30s` / `2m 14s` / `1h 5m`）。扩展用 `setInterval(refreshIntervalMs)` 主动调 `TreeDataProvider.refresh()` 让数字滚动。事件来了立即额外 refresh 一次，不等下一个 tick。

### 冷启动

扩展激活时：

1. 扫描 `sessions/` 下所有 `.jsonl` 文件
2. 每个文件逐行 replay 事件，重建 `SessionState`
3. 启动 chokidar 监听 `sessions/`：
   - `add` → 新文件 → 创建 session
   - `change` → 从 `fileOffset` 读尾部增量行，逐条 reduce 进状态
   - `unlink` → 移除 session（这是 `SessionEnd` 移文件的副作用）

### 孤儿会话清理

扩展启动时把 `mtime > staleHours`（默认 24h）的文件挪到 `.ended/`，避免 CLI 异常退出（kill -9、断电）留下永远活着的僵尸条目。

## 5. 扩展端代码结构

```
src/
├── extension.ts           # activate / deactivate, 连线所有模块
├── installer.ts           # 写 hook.sh, 幂等合并 settings.json, 检测 jq
├── watcher.ts             # chokidar 封装, emit 业务 SessionEvent
├── stateManager.ts        # 事件 reducer + Map<sessionId, SessionState>
├── treeDataProvider.ts    # 实现 vscode.TreeDataProvider<SessionState>
├── notifier.ts            # showWarningMessage + dedupe
├── types.ts               # SessionState, hook event 类型
└── test/
    ├── stateManager.test.ts      # 纯函数, 覆盖事件→状态转换表
    ├── installer.test.ts         # settings.json 幂等合并
    └── e2e.test.ts               # 写 jsonl → 验证 tree 更新
```

**单元可测性边界**：`stateManager` 是纯函数 reducer（`(state, event) => state`），`installer` 是纯 IO + JSON 合并逻辑，两者都不依赖 VS Code API，可在 vitest 里直接覆盖。`watcher` / `treeDataProvider` / `notifier` 是 VS Code API 适配层，走集成测试。

## 6. UI 设计

侧边栏一个自定义 view container（活动栏图标 + 同名 view），里面一个 flat tree（不展开，单层）。

每个 tree item：

| 字段 | 内容 | 示例 |
|---|---|---|
| `iconPath` | 三色 ThemeIcon | `new ThemeIcon('circle-filled', new ThemeColor('charts.red'))` |
| `label` | `path.basename(cwd)` | `my-api` |
| `description` | 状态文字 + 持续时间 | `等待权限 · 2m 14s` |
| `tooltip` | MarkdownString，含 cwd 完整路径、最近 prompt、当前/挂起工具 | (多行 markdown) |
| `command` | 点击触发的 VS Code 命令 | 见下 |

排序：🔴 在最前，🟡 次之，🟢 在后；同色按状态进入时间倒序。这样最需要关注的总在顶部。

空状态：tree 空时显示提示消息（VS Code 的 `viewsWelcome` 机制）："当前无活跃 Claude Code 会话。启动 `claude` 后自动出现。"

## 7. 点击跳转

```ts
item.command = {
  command: 'vscode.openFolder',
  arguments: [vscode.Uri.file(session.cwd), { forceNewWindow: false }],
  title: 'Open Project'
}
```

`vscode.openFolder` 的实际行为：
- 目标 folder 已在另一个 VS Code 窗口打开 → 聚焦那个窗口 ✓
- 没打开 → 在当前窗口替换 workspace（VS Code 会先弹确认）

**已知局限**：如果 CLI 跑在外部终端（Windows Terminal / iTerm / tmux），我们只能跳到项目，无法聚焦到那个具体的终端窗口。这是 VS Code API 的边界。文档里讲明。

## 8. 配置项（`package.json` 的 `contributes.configuration`）

| 键 | 默认 | 说明 |
|---|---|---|
| `claudeTaskMonitor.staleHours` | `24` | 文件 mtime 超过该值的会话视为僵尸，自动归档 |
| `claudeTaskMonitor.notifyDedupeSeconds` | `30` | 同一 session 在该秒数内不重复弹 🔴 通知 |
| `claudeTaskMonitor.refreshIntervalMs` | `1000` | 持续时间滚动刷新间隔 |

## 9. 安装 / 卸载

### Activation

`activationEvents: ["onStartupFinished"]`——必须开机即拉起，否则 CLI 先于 VS Code 启动时会错过现有会话的事件流。

### 激活时

1. 检测 `jq` 是否在 PATH。缺失则弹错误通知，附 brew/apt 安装指引，不阻塞激活（用户可能想先看看 UI）。
2. 创建 `~/.claude-task-monitor/sessions/` 和 `.ended/`。
3. 写入 `~/.claude-task-monitor/hook.sh` 并 `chmod +x`（如内容相同则跳过）。
4. 读取 `~/.claude/settings.json`，幂等合并 hooks 块（已存在 `_owner: "claude-task-monitor"` 的条目跳过）。
5. 启动 watcher + 冷启动重建状态。

### 卸载时（`deactivate`）

弹一次性确认 `"卸载时移除已注入的 Claude Code hooks?"`：
- 是 → 从 `~/.claude/settings.json` 移除带 `_owner: "claude-task-monitor"` 的条目，删除 `hook.sh`。`sessions/` 目录保留以便用户检查残留。
- 否 → 全部保留。

## 10. 错误处理 / 边界

| 场景 | 行为 |
|---|---|
| `jq` 未安装 | 通知 + 安装指引；watcher 仍启动；新事件会因 `hook.sh` 失败而丢失，但不崩 |
| `~/.claude/settings.json` 解析失败 | 跳过合并，通知用户文件路径与错误，不写坏文件 |
| watcher 启动失败（权限/路径） | 通知 + 写 extension output channel |
| 单行 JSONL 解析失败 | 跳过该行，写 output channel，不影响其他行 |
| 文件 IO 错误 | catch + log，不打断后续事件流 |
| `SessionStart` 缺失但其他事件先到 | StateManager 用首个见到的事件的 `cwd` 推断创建 session |
| `cwd` 缺失 | tree label 显示 `<unknown>`，tooltip 显示 sessionId |

## 11. 测试策略

### 单元测试（vitest）

- `stateManager.reduce(state, event)` 覆盖事件转换表的每一行
- `stateManager` 对乱序事件、重复事件、未知事件的鲁棒性
- `installer.mergeSettings(existing, ours)` 的幂等性、保留用户原有 hooks、不重复写入
- `notifier` 的 dedupe 窗口逻辑

### 集成测试（`@vscode/test-electron`）

- 写一个 jsonl 文件 → 验证 tree 出现新 item
- 追加 `Notification:permission_prompt` 事件 → 验证 item 变红 + 通知被触发
- 删除文件 → 验证 item 消失
- 冷启动场景：先在 fixture 目录放 jsonl → 扩展激活 → 验证状态正确重建

### 手动验收清单（文档形式，放 README）

- 多窗口并发：开 3 个 CLI，分别处于 🟢/🟡/🔴 三种状态 → 仪表盘正确
- 通知防骚扰：同一会话短时间内 PreToolUse + Notification 多次 → 只弹一次
- 异常退出：CLI `kill -9` → 文件残留 → 重启 VS Code 后会话被归档到 `.ended/`
- 跳转：点击不同状态的条目，验证 VS Code 行为符合预期

## 12. 技术栈

| 项 | 选型 | 理由 |
|---|---|---|
| 语言 | TypeScript（strict mode） | VS Code 扩展生态标配 |
| 构建 | `tsup` 或 `esbuild` | 比 webpack 快，配置极少 |
| 包管理 | `pnpm` | 快，依赖管理严格 |
| 测试 | `vitest`（单元）+ `@vscode/test-electron`（集成） | vitest 跑纯函数极快，集成跑真 VS Code |
| 运行时依赖 | `chokidar` | 唯一外部 npm 依赖，跨平台 file watcher 事实标准 |
| 系统依赖 | `jq` | hook 脚本里用，installer 检测 |

## 13. 已知局限（v1 接受）

- 外部终端运行的 CLI 不能"聚焦到那个终端窗口"，只能开项目
- 远程 SSH 上的 CLI 不监控
- 没有历史/统计视图
- `jq` 依赖（未来可改用 Node 脚本，但当前用 jq 最简）
- 多用户系统（同一台机器多账户）每个用户各自的 `~/.claude-task-monitor/`，不互通

## 14. 未来可能（不在 v1 范围）

仅记录，便于评估架构是否过度封闭：

- 远程监控：方案 A 的文件格式可直接当 wire protocol，加一个 daemon 把远端文件 stream 过来即可
- 历史视图：`.ended/` 文件已经天然是历史；加一个 toggle 即可暴露
- 桌面通知：`Notifier` 加一个 channel 即可，状态机不变
- Cost/token 统计：reduce 时累加 hook payload 中的 token 字段（如有）
