# Implement — 跨窗口通知去重 (leader election)

> 实施路径。Phase 2 启动后按本清单顺序执行；每条完成后勾选 + commit-ready 描述。

## Step 1. 新增 `src/util/leaderLock.ts`（核心原语）

**目标**：纯文件状态协调器；可注入 clock / paths；零 VS Code 依赖（便于单测）。

实现要点（按 `design.md` §2）：

```ts
// src/util/leaderLock.ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const DEFAULT_HEARTBEAT_INTERVAL_MS = 2000
const DEFAULT_STALE_AFTER_MS = 6000

interface LockPayload {
  pid: number
  host: string
  acquiredAt: number
  heartbeat: number
}

export interface LeaderLockOptions {
  lockPath?: string          // 默认 ~/.claude-task-monitor/notify-leader.lock
  host?: string              // 默认 os.hostname()
  pid?: number               // 默认 process.pid
  heartbeatIntervalMs?: number
  staleAfterMs?: number
  clock?: () => number       // 默认 Date.now,测试用
}

export class LeaderLock {
  // isLeader() / tryAcquireNow() / start() / stop() / release() / disable()
  // 构造时不读盘 —— 第一次调用才碰 fs
}
```

**关键不变式**：
- 所有 fs 操作包 try/catch；任何 throw 一律 fail-open（返回 `true`）
- `release()` 仅在 `isLeader()` 为 true 时删文件
- `disable()` 后 `isLeader()` 恒为 true（配置开关）

**风险点**：
- 多窗口并发 acquire 的"双胜出"窗口期——由 heartbeat 间隔决定最大双弹时长 ≈ STALE_AFTER_MS
  = 6s 一次。AC2/AC3 要求**总共只弹一条**，实测场景中双弹概率极低（两个窗口几乎同时 acquire 才会）；
  即使发生，下次 tick 自动收敛。
- `os.hostname()` 在某些容器环境返回 12 位 hex——直接用作文件名/字段名都没问题，
  不需要 sanitize。

**验收**：`pnpm test` 通过 `src/test/leaderLock.test.ts`（见 Step 4）。

---

## Step 2. `src/extension.ts` — 接入闸门

**2a. 读取新配置**（紧跟 `notifyMode` 解析后，约 L60）：

```ts
const notifyLeaderElection = cfg.get<boolean>('notifyLeaderElection', true)
const leaderLock = new LeaderLock({ /* 用 ROOT_DIR 拼 lockPath */ })
if (!notifyLeaderElection) leaderLock.disable()
```

**2b. 启动 / 监听窗口状态**（紧跟 `langToggle` 构造后，约 L184）：

```ts
leaderLock.start()
if (vscode.window.state?.focused) leaderLock.tryAcquireNow()
const windowStateSub = vscode.window.onDidChangeWindowState(state => {
  if (state.focused) leaderLock.tryAcquireNow()
})
```

**2c. NotifyFn 回调闸门**（L108-129 的 lambda 首行）：

```ts
const notifier = new Notifier(dedupeSeconds, (kind, sessions) => {
  if (notifyMode === 'silent') return
  if (notifyLeaderElection && !leaderLock.isLeader()) return   // ← 新增一行
  // ...既有 fireSingle / aggregate 逻辑
})
```

**2d. 注销**（L349-403 的 `context.subscriptions.push(...)` 块末尾）：

```ts
windowStateSub,
{ dispose: () => leaderLock.stop() }
```

**2e. onDidChangeConfiguration 热更新**（L371 监听器尾部）：

```ts
if (e.affectsConfiguration('claudeTaskMonitor.notifyLeaderElection')) {
  const on = vscode.workspace.getConfiguration('claudeTaskMonitor')
    .get<boolean>('notifyLeaderElection', true)
  on ? leaderLock.enable() : leaderLock.disable()
}
```

**风险点**：L108 的 lambda 是 async/Promise 链中的箭头函数，
加 `return` 不会影响外层；既有 `fireSingle` 是 `function`，不会受影响。

**验收**：`pnpm test` + 手动 AC1（3 窗口场景）。

---

## Step 3. `package.json` — 新增配置

`contributes.configuration.properties` 内新增（参考 `notifyDedupeSeconds` 位置）：

```json
"claudeTaskMonitor.notifyLeaderElection": {
  "type": "boolean",
  "default": true,
  "description": "跨窗口通知去重 (leader election)。多开 VS Code 窗口时,同一 waiting 事件只由最近聚焦的窗口弹通知。关闭则回到旧行为:每个窗口各弹一条。"
}
```

**注意**：description 是中文直写，与 `claudeTaskMonitor.language` 等既有 key 风格一致，
无 `package.nls.json` i18n key——保持项目既有约定（见 `.trellis/spec/i18n.md`）。

**风险点**：无需 bump version——发布流水线由独立 release task 处理。

**验收**：`pnpm build` 不报 schema 错；`code --extensionDevelopmentPath` 可读取新 key。

---

## Step 4. `src/test/leaderLock.test.ts`（新增测试）

按 `.trellis/spec/testing.md` 风格：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { LeaderLock } from '../util/leaderLock'

describe('LeaderLock', () => {
  let tmpDir: string
  let lockPath: string
  let clock: number
  const opts = () => ({
    lockPath,
    host: 'test-host',
    pid: 10001,
    heartbeatIntervalMs: 50,
    staleAfterMs: 200,
    clock: () => clock
  })

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctm-leader-'))
    lockPath = path.join(tmpDir, 'lock.json')
    clock = 1_700_000_000_000
  })
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('空目录 → acquire 后 isLeader() 为 true', () => { /* ... */ })
  it('本窗口仍是 leader → 续约不踩自己', () => { /* ... */ })
  it('其他 host 持锁 → 我们视为无主并抢锁', () => { /* ... */ })
  it('心跳过期 → 我们接管', () => {
    // 写一个旧 leader 锁,clock 推到 STALE_AFTER_MS 之后
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 9999, host: 'test-host',
      acquiredAt: clock - 1000, heartbeat: clock - 1000
    }))
    clock += 250
    const lk = new LeaderLock(opts())
    expect(lk.tryAcquireNow()).toBe(true)
    expect(lk.isLeader()).toBe(true)
  })
  it('锁文件损坏 → fail-open 返回 true', () => {
    fs.writeFileSync(lockPath, '{not json')
    const lk = new LeaderLock(opts())
    expect(lk.isLeader()).toBe(true)  // fail-open
  })
  it('锁文件 chmod 000 → fail-open', () => {
    if (process.platform !== 'win32') {
      fs.writeFileSync(lockPath, '{}')
      fs.chmodSync(lockPath, 0o000)
    }
    const lk = new LeaderLock(opts())
    expect(lk.isLeader()).toBe(true)
    fs.chmodSync(lockPath, 0o600)  // 清理
  })
  it('release() 只在持锁时删文件', () => { /* ... */ })
  it('disable() 后 isLeader 恒为 true', () => { /* ... */ })

  describe('多进程竞争', () => {
    it('3 个 child 同时抢锁,恰好 1 个胜出', async () => {
      const { spawn } = await import('node:child_process')
      // 启动 3 个 node 子进程,各跑同一段 tryAcquireNow + 输出结果
      // 父进程等齐 3 行 stdout,断言恰好 1 个 'LEADER\n'
      // 测试结束 child.kill() + fs.rmSync
    }, 15000)
  })
})
```

**风险点**：
- 多进程测试跨平台兼容性：`process.platform === 'win32'` 时 `chmod 000` 跳过
- 临时目录清理 `afterEach` 兜底（即便 `it` 中途 throw 也会执行）
- child process 测试 timeout 设 15s（参照 testing.md:「Real process tests need longer」）

**验收**：`pnpm test src/test/leaderLock.test.ts` 全绿。

---

## Step 5. 补 `.trellis/spec/architecture.md` + `lifecycle.md`（AC7）

**5a. `architecture.md`**：在「Boundaries That Are Not There」段后追加：

```markdown
#### Cross-window coordination via lock file (08-31)

The extension host runs once per VS Code window; `Notifier` is process-local, so
without coordination the same `waiting` event triggers N toasts for N windows.
We elect a single toast emitter per host via a file lock at
`~/.claude-task-monitor/notify-leader.lock`.

Properties:
- File-based; no IPC, no network, no port.
- Per-host isolation (`os.hostname()`) — shared `$HOME` across machines (NFS)
  does NOT suppress notifications on the other host.
- Fail-open: any fs error → `isLeader()` returns true → fall back to "all
  windows notify" (the pre-feature behavior). Missing a notification is worse
  than duplicating one.
- Implementation: `src/util/leaderLock.ts`. Gated by
  `claudeTaskMonitor.notifyLeaderElection`.

This is **not** general cross-process state — it's a single-purpose coordination
signal. The `_owner`-tagged settings.json and `muted.json` patterns are
unchanged.
```

**5b. `lifecycle.md`**：在 notifier 段落加子节：

```markdown
#### Leader election gating (08-31)

`Notifier` 回调首行检查 `leaderLock.isLeader()`；非 leader 窗口的 toast 路径
直接 return。sidebar / status bar / badge 不受影响（走 `store.onChange`，
与 toast 路径正交）。`src/extension.ts:108` 的回调结构保持不变，只是首行多一道闸门。
```

**验收**：`grep -R "leaderLock\|notifyLeaderElection" .trellis/spec/` 能看到引用。

---

## Step 6. 验证

按顺序：

```bash
pnpm test                                # 单测全绿(尤其新增的 leaderLock.test.ts)
pnpm build                               # tsup 不报错
# 手动 AC1:开 3 个 VS Code 窗口,触发一个 waiting → 应只弹 1 条 toast
# 手动 AC2:关掉发射窗口后,再触发 waiting → 剩余窗口中恰好 1 条
# 手动 AC3:kill -9 发射窗口的 VS Code 进程,6s 内剩余窗口接管
# 手动 AC4:单窗口运行,所有行为与 v0.3.5 一致
# 手动 AC5:chmod 000 notify-leader.lock,所有窗口照常弹 toast
```

`pnpm test:integration` 本任务**不**新增项（多窗口 e2e 成本不匹配），
保留既有 e2e 套件跑通即可。

---

## Step 7. Commit

提交信息（沿用仓库既有风格，参考 `git log`）：

```
feat(notify): cross-window dedupe via leader election lock

开 N 个 VS Code 窗口时,同一 waiting 事件只弹 1 条 toast (取代原来
每个窗口各弹一条的体验)。基于 ~/.claude-task-monitor/notify-leader.lock
的焦点感知选举:持锁者 = 最近聚焦的窗口;心跳过期或主动释放后接管。
任意 fs 异常走 fail-open,绝不让所有窗口同时静默。
```

---

## 风险与回滚

- **最大风险**：timer / 监听器泄漏 → `context.subscriptions.push(leaderLock.stop())`
  + 在 `afterEach` 测试中验证无孤儿 interval
- **次大风险**：多窗口竞争出现双 toast（极小概率窗口期 ≈ STALE_AFTER_MS）→
  下一次 tick 自动收敛,且不影响数据正确性
- **回滚**：revert 4 处改动（leaderLock.ts + leaderLock.test.ts +
  extension.ts + package.json + 2 个 spec 文件），零数据迁移（lock 文件
  不删也无所谓，下次启动被新版本忽略）

---

## Step 8. 触发 task.py start 的前置

按 brainstorm skill 约定：**本实施计划 + prd.md + design.md 须经用户
显式确认后才执行 `task.py start`**。本文件即"最终规划摘要"的载体，
等你看完 ack 后再走 Step 1。