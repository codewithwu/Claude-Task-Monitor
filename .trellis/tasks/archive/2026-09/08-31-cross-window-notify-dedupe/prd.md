# 跨窗口通知去重 (leader election)

## Goal

多开 VS Code 窗口时，同一个 waiting 事件只弹**一条** toast，而不是每个窗口各弹一条；
同时每个窗口的 sidebar / status bar / badge 仍各自正确更新。

用户价值：这个插件的目标画像就是「同时跑 3~5 个 claude 会话」的人，
而这类人通常也同时开多个 VS Code 窗口。当前实现下，**用户越符合目标画像，
被通知骚扰得越狠**——正好打在 README「设计初心」的反面。

## Background — 已确认的事实（代码证据）

**F1. 每个 VS Code 窗口一个独立 extension host 进程。**
`package.json` 的 `activationEvents: ["onStartupFinished"]` 使扩展在每个窗口各激活一次，
各自执行 `activate()`（`src/extension.ts:48`）。

**F2. 现有 dedupe 是进程内的，跨窗口无效。**
`Notifier.lastNotifiedAt` 是实例字段 `Map<string, number>`（`src/notifier.ts:32`），
随 extension host 进程存在。N 个窗口 = N 份独立 dedupe 状态 = N 条 toast。
`notifyDedupeSeconds` 配置只在单进程内生效。

**F3. toast 的实际发射点在 `extension.ts`，不在 `Notifier` 内部。**
`Notifier` 只做纯 dedup + 维护 `currentWaiting`，通过构造器注入的 `NotifyFn` 回调
把 VS Code API 调用留在 `src/extension.ts:108-129`（`showWarningMessage`）。
`.trellis/spec/lifecycle.md:131` 明确要求保持这个切分——
「Don't put `vscode.window.showWarningMessage` calls inside `Notifier`」，
目的是让 `notifier.test.ts` 无需 mock VS Code。
**因此闸门应加在 `extension.ts` 的回调里，不进 `Notifier`。**

**F4. sidebar / status bar / badge 走的是另一条路径，不受影响。**
它们由 `store.onChange` → `syncWaitingDependentUI()` 驱动（`src/extension.ts:326-336`），
与 toast 路径正交。只拦 toast 不会让其他窗口的视觉状态失准。

**F5. VS Code toast 是窗口内的，不是 OS 级通知。**
`showWarningMessage` 只在调用它的那个窗口渲染。若该窗口不可见/未聚焦，
用户当下看不到（会留在该窗口的通知中心）。
**推论：选错窗口 = 通知等于没发。**这是本任务的核心风险。

**F6. 项目已有跨进程文件状态的先例。**
`~/.claude-task-monitor/muted.json`（`MutedStore`，`src/util/muted.ts`）已经在多窗口间共享落盘状态，
`~/.claude-task-monitor/` 目录本身由 `activate()` 保证存在（`src/extension.ts:86`）。
新增一个协调文件不引入新的目录约定。

**F7. 架构 spec 对新增跨进程机制有明确态度。**
`.trellis/spec/architecture.md` 的「Boundaries That Are Not There」列出
「IPC / network — the extension never opens a port」与「Persisted state」，
并要求 "If a change needs any of these, it needs a discussion, not just a patch"。
本任务用**文件锁**而非端口/IPC，落在既有 fs 约定内，但仍需在 spec 中补记
（见 AC7）。

**F8. 失败代价不对称。**
漏弹通知（用户干等）比重复弹通知（当前现状）严重得多。
这与 `.trellis/spec/index.md` 的 liveness 原则同构：
「when in doubt, treat a process as alive… False positives are worse than false negatives」。
**推论：任何异常路径必须 fail-open（照弹），绝不 fail-silent。**

## Requirements

- **R1** 同一时刻，一个 waiting 事件在所有窗口中合计只产生一条 toast。
- **R2** 非发射窗口的 sidebar / status bar / badge 行为完全不变（F4）。
- **R3** 单窗口场景行为与当前版本一致，无回归。
- **R4** 持有者窗口正常关闭时主动释放，其他窗口应在数秒内接管。
- **R5** 持有者窗口崩溃 / 被 `kill -9` 时，其他窗口应在过期阈值后接管（无需用户干预）。
- **R6** 协调文件不可读 / 不可写 / 内容损坏时，**回落到当前行为（各窗口照弹）**，
  绝不出现「所有窗口都以为别人会弹」的静默死区（F8）。
- **R7** 提供配置开关允许用户关掉本机制，回到旧行为。
- **R8** 共享 `$HOME` 的多主机场景（NFS / 远程同步）不得互相压制通知——
  选举必须是**每主机独立**的。

## Acceptance Criteria

- [ ] **AC1** 开 3 个 VS Code 窗口，触发一个会话进入 waiting：全局只出现 1 条 toast，
      且 3 个窗口的 sidebar 条目、status bar 文案、badge 数字都正确更新。
- [ ] **AC2** 关闭当前发射窗口后再触发 waiting：剩余窗口中恰好 1 个弹出 toast。
- [ ] **AC3** `kill -9` 掉发射窗口的 extension host 后再触发 waiting：
      过期阈值内剩余窗口恰好 1 个弹出 toast。
- [ ] **AC4** 单窗口运行：toast 行为、dedupe 窗口、聚合文案与 v0.3.5 一致。
- [ ] **AC5** 协调文件被 `chmod 000` 或写入垃圾内容后：所有窗口照常弹 toast（fail-open），
      不抛未捕获异常，不出现零通知。
- [ ] **AC6** 单元测试覆盖：获取 / 续约 / 过期接管 / 释放 / 损坏内容回落；
      多进程场景用真实 child process 验证「只有一个赢家」
      （遵循 `.trellis/spec/testing.md` 的 real-child-process 约定，并清理临时目录）。
- [ ] **AC7** `.trellis/spec/architecture.md` 与 `lifecycle.md` 补记该跨进程协调机制
      及其 fail-open 原则。

## Out of Scope

- **不改** `Notifier` 的类型签名与既有 dedupe 语义（F3 的切分必须保住）。
- **不做** OS 级通知 / 声音（那是改进清单 #9，独立任务）。
- **不做** 跨窗口共享 liveness prune / `archiveStaleFiles` 的抢占——
  多窗口并发 rename 同一文件目前靠 try/catch 兜底（`src/liveness.ts:173`、
  `src/extension.ts:513`），**属于既存行为，本任务不动**。若要收敛，另开任务。
- **不做** 跨主机（共享 `$HOME`）的统一选举——按 R8 明确隔离即可。

## Key Decisions

- **D1（Q1 决议）发射窗口 = 最近聚焦的窗口。** 监听 `vscode.window.onDidChangeWindowState`，
  `state.focused === true` 时本窗口立即抢锁（heartbeat 写入），同时上一持锁者下次 tick
  发现锁已过期（被新持有者覆盖）→ 自动让位。无窗口聚焦时维持上一持锁者，避免空窗静默期。
  决议理由：桌面上同一时刻最多一个聚焦窗口 → 选举天然收敛；通知几乎总能落在用户眼前；
  无需 project ↔ workspace 匹配，回落链短；测试矩阵最小。
  **违反 F5 的风险（toast 落在不可见窗口）只发生在用户正在浏览器/其他桌面的短暂空窗期，
  上一持锁者代为保留通知中心记录，回切窗口时仍可见——而当前方案下这种情况同样有 1 条 toast
  留在该窗口，不退化。**

## Open Questions

（无阻塞项）
