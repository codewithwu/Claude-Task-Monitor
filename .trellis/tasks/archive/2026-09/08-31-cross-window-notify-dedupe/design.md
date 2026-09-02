# Design — 跨窗口通知去重 (leader election)

## 1. 架构边界

新增一个**纯文件状态原语** `src/util/leaderLock.ts`，扩展通过它在多窗口间协调
"谁是当前 toast 发射者"。关键边界：

```
┌──────────────────────────────────────────────────────────┐
│  src/notifier.ts   (NOT modified)                         │
│    纯 dedup + currentWaiting —— 职责不动 (F3)             │
└─────────────────────────┬────────────────────────────────┘
                          │ NotifyFn 回调
                          ▼
┌──────────────────────────────────────────────────────────┐
│  src/extension.ts   (modified)                            │
│    Notifier 回调首行:                                      │
│      if (!leaderLock.isLeader()) return;  ← 闸门          │
│    其余 fireSingle / aggregate 路径不变                     │
└─────────────────────────┬────────────────────────────────┘
                          │ isLeader() / heartbeat / release
                          ▼
┌──────────────────────────────────────────────────────────┐
│  src/util/leaderLock.ts  (NEW, ~120 行)                   │
│    • 文件路径: ~/.claude-task-monitor/notify-leader.lock  │
│    • 内容 JSON: {pid, host, acquiredAt, heartbeat}         │
│    • API: acquire(), release(), isLeader(), start()/stop()│
│    • 可注入 clock / paths,便于纯函数单测                   │
└─────────────────────────┬────────────────────────────────┘
                          │ fs.write / read
                          ▼
     ~/.claude-task-monitor/notify-leader.lock
```

`Notifier` 类型签名与 dedupe 语义不变；只在 `extension.ts` 回调首行加一道闸门。
spec `lifecycle.md:131` 的「不要把 vscode.window.showWarningMessage 放进 Notifier」
约束依然守住。

## 2. 锁文件协议

### 2.1 路径与命名

```
$ROOT/.claude-task-monitor/notify-leader.lock
```

单文件，无后缀轮转。`$ROOT` 与 `muted.json` 共用同一个目录（`SESSIONS_DIR` 旁），
由 `activate()` 在 mkdir 时同步保证存在（F6）。

### 2.2 内容格式

```json
{
  "pid": 4711,
  "host": "mbp-cooper",
  "acquiredAt": 1735670400000,
  "heartbeat": 1735670402000
}
```

| 字段 | 来源 | 用途 |
|---|---|---|
| `pid` | `process.pid` | 调试/可读性;**不**作为活性判定（让位靠 heartbeat） |
| `host` | `os.hostname()` | **R8 隔离**：不同 host 视为不同持锁者 |
| `acquiredAt` | 第一次 acquire 时设置 | 供 UI/日志显示「已独占多久」 |
| `heartbeat` | 每次 tick 续约 | **唯一的活性证据** |

### 2.3 阈值常量

```
HEARTBEAT_INTERVAL_MS = 2000   // 持锁者每 2s 写一次 heartbeat
STALE_AFTER_MS        = 6000   // 3× heartbeat,容忍一次 GC 暂停 / IO 抖动
```

放在 `src/util/leaderLock.ts` 顶部 `const`，便于单测时覆写。
**遵循 `liveness.md` 的「conservative by design」**——3× 而非 2×，
避免正常的 JS event-loop 长尾引发误接管。

### 2.4 acquire() 判定逻辑（伪代码）

```
try:
  raw = fs.readFileSync(LOCK_PATH, 'utf8')
  parsed = JSON.parse(raw)
  if parsed.host != OUR_HOST:           // R8:跨主机不互相压制
    return acquireOrOverwrite(parsed)
  age = now - parsed.heartbeat
  if age > STALE_AFTER_MS:              // 上一持锁者已死
    return acquireOrOverwrite(parsed)
  return parsed.pid == OUR_PID          // 自己仍是持锁者 → 续约
catch ENOENT:
  return acquireOrOverwrite(null)       // 文件不存在 → 我们是第一个
catch (any error):                       // R6 fail-open
  log.warn('leaderLock read failed', e)
  return true                            // 本轮视为持锁者,弹出通知
```

`acquireOrOverwrite`：写入 `{pid: ours, host: ours, acquiredAt, heartbeat: now}`
并返回 `true`。**不**做 rename + fsync 原子写入——不必要：
  - 失败的代价 = 失去本轮持锁机会 = 别人抢到 → 下次心跳再抢
  - F8 的不对称代价原则下，简化实现是正确的

### 2.5 isLeader() / heartbeat / release

```
isLeader():
  return heartbeat 上一次成功覆盖了 LOCK_PATH 的 OUR_HOST+OUR_PID

heartbeat tick (setInterval):
  if isLeader():  fs.writeFileSync(LOCK_PATH, json)  // 续约
  else if weAreFocused():  acquire()                 // 抢锁

release():
  // 仅在持有者主动让位时调用(失去聚焦/正常关闭)
  // 注意:R5 的"崩溃"路径不需要 release —— 自然过期
  if isLeader():
    try: fs.unlinkSync(LOCK_PATH)
    catch: pass   // 已经过期被别人接管 → 静默
```

**重要边界**：release 仅在持锁者**当前确认是 leader** 时删文件，
不删别人的锁。

## 3. 与 VS Code windowState 的联动

`src/extension.ts` 的 `activate()` 里：

```ts
const leaderLock = new LeaderLock()
leaderLock.start()   // 启动 heartbeat interval

const onWindowStateChange = (state: vscode.WindowState) => {
  if (state.focused) {
    leaderLock.tryAcquireNow()    // 抢锁
  }
  // 失焦时：不主动 release —— 让 heartbeat 自然停止,
  // 锁文件会在 STALE_AFTER_MS 内过期,别人自然接管。
  // 这避免了"用户临时 alt-tab,刚失焦就被别人抢"的抖动。
}
context.subscriptions.push(
  vscode.window.onDidChangeWindowState(onWindowStateChange),
  // 启动时若本窗口已聚焦(最常见),立即抢一次
  // —— vscode.window.state 在 extension host 启动时未必有回调触发
  { dispose: () => leaderLock.stop() }
)
if (vscode.window.state?.focused) {
  leaderLock.tryAcquireNow()
}
```

**NotifyFn 回调闸门**（`src/extension.ts:108` 现有回调首行）：

```ts
const notifier = new Notifier(dedupeSeconds, (kind, sessions) => {
  if (notifyMode === 'silent') return
  if (!leaderLock.isLeader()) return    // ← 新增:R1/R6
  // ...现有 fireSingle / aggregate 逻辑不变
})
```

## 4. 配置

`package.json` 新增：

```json
"claudeTaskMonitor.notifyLeaderElection": {
  "type": "boolean",
  "default": true,
  "description": "跨窗口通知去重 (leader election)。多开 VS Code 窗口时,同一 waiting 事件只由最近聚焦的窗口弹通知。关闭则回到旧行为:每个窗口各弹一条。"
}
```

读取方式沿用既有约定（`src/extension.ts:50-72` 的 cfg pattern）：

```ts
const notifyLeaderElection = cfg.get<boolean>('notifyLeaderElection', true)
// ↓
if (!notifyLeaderElection) leaderLock.disable()   // 永远返回 isLeader()=true
```

**注**：本扩展的 cfg description 直接写中文串（与既有 `claudeTaskMonitor.language` 等一致），
无 i18n key 走 `package.nls.json`——保持项目既有风格。

## 5. 与现有机制的交互矩阵

| 场景 | leaderLock 状态 | toast 行为 |
|---|---|---|
| 单窗口 | 永远持锁 | 与 v0.3.5 完全一致（AC4） |
| 多窗口 + A 聚焦 | A 持锁 | 只有 A 弹（AC1） |
| 用户切到 C | C 立即抢锁 | 切完后 C 弹,A 失去（AC2） |
| A 被 `kill -9` | A 心跳停,B/C 6s 后过期接管 | B 或 C 之一接管后弹（AC3） |
| `chmod 000 notify-leader.lock` | acquire() catch → fail-open | **所有窗口都弹**（AC5） |
| 共享 $HOME 的 NFS（host=X, host=Y） | 各持自己的锁 | 各自独立弹（R8） |
| 用户把 `notifyLeaderElection: false` | leaderLock.isLeader() 恒为 true | 旧行为（N 个窗口 N 条 toast） |

## 6. 测试策略

### 6.1 单元测试（`src/test/leaderLock.test.ts`）

- 单测 API：`acquire` / `isLeader` / `release` / 过期接管 / 损坏内容回落
- 通过注入 `clock` + `paths` 实现纯函数测，无需 child process
- 覆写 `HEARTBEAT_INTERVAL_MS` / `STALE_AFTER_MS` 到 50ms / 200ms 让测试快

### 6.2 多进程测试（同一文件内，独立 `describe`）

- 遵循 `testing.md` 的 real-child-process 约定
- `spawn` 2~3 个 `node -e "import('./leaderLock')..."` 子进程，竞争 acquire
- 用 signal 协调：通过子进程 stdout 报告自身状态，父进程等齐 N 个赢家宣告
- **断言**：恰好 1 个 `acquired-leader` 事件
- **清理**：每个 `spawn` 配 `child.kill()` + `fs.rmSync(tmpDir, { force: true })`
  （遵循 testing.md 的 cleanup 约定）

### 6.3 集成测试

集成测试 (`src/test/integration/suite/e2e.test.ts`) 当前只覆盖基本流，
本任务**不新增**集成测试项（开 3 个 VS Code 实例成本/脆弱性不匹配本任务价值）。
AC1/AC2 由用户在验收清单跑（见 README 现有模式）。

## 7. 失败模式与回滚

| 失败 | 检测 | 处理 |
|---|---|---|
| 锁文件被外部删除 | acquire() 读到 ENOENT → 视为无主 → 自己抢 | 正常 |
| 锁文件被外部篡改 | parse 失败 → catch 回落 → 视为持锁 | R6 fail-open |
| 锁文件被 `chmod 000` | readFileSync EACCES → catch → fail-open | R6（AC5） |
| fs 本身异常（磁盘满） | 写心跳失败 → 下次 isLeader() 仍可能返回 true（基于上次成功） | 暂时不正确但有界：STALE_AFTER_MS 后自然让位 |
| clock skew（主机时钟跳变） | `now - heartbeat` 计算异常 | 容忍；最坏情况错一次让位，下个心跳恢复 |
| 用户改回 `notifyLeaderElection: false` | leaderLock.disable() | 立即生效，无需重启（沿用既有热更新模式） |

**回滚点**：本任务核心改动集中在 2 个新文件 (`leaderLock.ts` + 测试) +
2 处现有文件改动 (`extension.ts` 回调首行加 5 行 + `package.json` 加配置)。
**回滚方式**：revert 4 处改动即可，零数据迁移成本（lock 文件不删也无所谓，下次启动被忽略）。

## 8. Spec 更新（AC7）

需要补记到 `.trellis/spec/`：

- `architecture.md`：在「Boundaries That Are Not There」旁新增一段
  「Cross-window coordination via lock file」，注明 `notify-leader.lock`、
  fail-open 原则、host 隔离、不引入 IPC/网络
- `lifecycle.md`：在 notifier 段落补充「Leader election gating」
  子节，指向 `leaderLock.ts`

**不**新增 spec 文件——本任务仍属已有架构边界内的扩展，
而非引入新边界。

## 9. 不做的事（Out of Scope 落实）

- OS 级 / 声音通知（改进清单 #9）→ 另立 task
- 跨窗口共享 liveness prune 抢占 → 另立 task
- 项目 cwd ↔ workspaceFolder 匹配（D1 决议不采用方案 C）