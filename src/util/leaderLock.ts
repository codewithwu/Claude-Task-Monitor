// 跨窗口通知去重的 leader-election 原语 (08-31 cross-window-notify-dedupe)。
//
// 背景:
//   - 多开 VS Code 窗口时,每个窗口各自跑一个 extension host,各自有一个 Notifier
//     实例,各自走自己的 process-local dedupe —— 同一个 waiting 事件会弹 N 条 toast。
//   - 用一个文件锁 ~/.claude-task-monitor/notify-leader.lock 协调:
//       持锁者 = 当前聚焦的窗口,只有它弹 toast。
//   - 锁字段: { pid, host, acquiredAt, heartbeat }
//       - pid 用于调试/可读性,**不**作为活性证据 (让位靠 heartbeat)
//       - host (os.hostname) 用于 R8 隔离 —— NFS 共享 $HOME 时不同主机互不压制
//       - heartbeat 是**唯一**的活性证据;超过 STALE_AFTER_MS 视为过期
//
// Fail-open (F8 / R6):
//   任何 fs / JSON.parse 异常一律把本进程视为持锁者,让 toast 照常弹。
//   漏弹通知比重复弹通知严重得多 (与 liveness.ts 的「conservative by design」同构)。
//
// 测试约定:
//   - 纯 node:fs / os / path,**不** import vscode —— 单测无 VS Code mock。
//   - 所有路径 / 时钟 / 阈值均可通过构造 opts 注入,让单测快且确定。

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { formatErrorMessage } from './formatError.js'

const DEFAULT_HEARTBEAT_INTERVAL_MS = 2000
const DEFAULT_STALE_AFTER_MS = 6000  // 3 × heartbeat,容忍一次 GC 暂停 / IO 抖动

interface LockPayload {
  pid: number
  host: string
  acquiredAt: number
  heartbeat: number
}

export interface LeaderLockOptions {
  /** 锁文件路径;默认 ~/.claude-task-monitor/notify-leader.lock */
  lockPath?: string
  /** 主机标识;默认 os.hostname()。R8 跨主机隔离用 */
  host?: string
  /** 持锁进程 PID;默认 process.pid */
  pid?: number
  /** 心跳间隔 (ms);默认 2000 */
  heartbeatIntervalMs?: number
  /** 心跳过期阈值 (ms);默认 6000 (= 3 × heartbeat) */
  staleAfterMs?: number
  /** 时间源;默认 Date.now。测试可注入固定 clock */
  clock?: () => number
}

export class LeaderLock {
  private readonly lockPath: string
  private readonly host: string
  private readonly pid: number
  private readonly heartbeatIntervalMs: number
  private readonly staleAfterMs: number
  private readonly clock: () => number

  private timer: ReturnType<typeof setInterval> | null = null
  private amLeader = false
  private active = false  // 由 setActive 控制 —— extension.ts 在窗口聚焦时 true
  private disabled = false  // 配置开关: notifyLeaderElection=false 时永远视作持锁者
  /** 本进程首次持锁的时间戳;renew 时复用,避免 acquiredAt 每次重置 */
  private acquiredAt: number | null = null

  constructor(opts: LeaderLockOptions = {}) {
    this.lockPath = opts.lockPath ?? path.join(os.homedir(), '.claude-task-monitor', 'notify-leader.lock')
    this.host = opts.host ?? os.hostname()
    this.pid = opts.pid ?? process.pid
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
    this.staleAfterMs = opts.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
    this.clock = opts.clock ?? Date.now
  }

  /**
   * 启动心跳定时器。重复调用幂等。
   * 不立即尝试抢锁 —— 让 extension.ts 在窗口聚焦时显式调 setActive(true) + tryAcquireNow。
   */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), this.heartbeatIntervalMs)
  }

  /**
   * 停心跳 + 主动释放锁 (extension deactivate 路径)。
   * 与 pause() 的区别:会删除锁文件 (虽然可能被别人接管了,删除静默失败)。
   */
  stop(): void {
    this.pause()
    this.release()
  }

  /**
   * 仅停心跳,不删锁文件 —— 让锁自然过期 (STALE_AFTER_MS),别人接管。
   * 失焦路径 (windowState.blur) 调用,避免"临时 alt-tab 就被抢"的抖动。
   */
  pause(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
    // amLeader 不重置 —— acquire 状态保留,直到下次 acquire 调用重新校验
  }

  /**
   * 重新启动心跳 (resume)。重复调用幂等。
   * 通常与 setActive(true) + tryAcquireNow 配对使用 (focus 路径)。
   */
  resume(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), this.heartbeatIntervalMs)
  }

  /**
   * 通知本进程是否应"积极争抢"持锁者身份。
   *  - active=true (聚焦):允许心跳 + tryAcquireNow
   *  - active=false (失焦):心跳无操作,但锁文件**不删** —— 自然过期
   *
   * 不主动调 tryAcquireNow —— 由 extension.ts 在聚焦事件里显式调。
   */
  setActive(active: boolean): void {
    this.active = active
  }

  /**
   * 立即尝试成为 leader。
   * 返回 true 表示本进程现在是 (或仍然是) leader,false 表示别的进程是 leader。
   * 任何 fs 异常一律 fail-open 返回 true (F8)。
   */
  tryAcquireNow(): boolean {
    if (this.disabled) {
      this.amLeader = true
      return true
    }
    return this.attemptAcquire()
  }

  /**
   * 当前是否为本进程的 leader 身份。NotifyFn 回调闸门读这个值。
   * disabled=true 时恒返回 true (配置开关关闭 → 旧行为)。
   * 任何 fs 异常 fail-open 返回 true —— 见 F8。
   */
  isLeader(): boolean {
    if (this.disabled) return true
    return this.amLeader
  }

  /**
   * 主动让位。仅在当前确认是 leader 时删文件,不删别人的锁。
   * 失败静默 —— 文件可能已被别人接管 (R5 崩溃后场景),无需告警。
   */
  release(): void {
    if (!this.amLeader) return
    this.amLeader = false
    this.acquiredAt = null
    try {
      fs.unlinkSync(this.lockPath)
    } catch (e) {
      // ENOENT/EACCES 都吞:别人已经接管 / 没权限 → 静默
      // 仅在异常对象有 message 时打 warn,避免空对象触发 console.warn 报警
      const msg = formatErrorMessage(e)
      if (msg && msg !== 'ENOENT: no such file or directory') {
        // 真正的 IO 错误值得 warn;ENOENT 是预期路径
        console.warn(`[claude-task-monitor] leaderLock release failed: ${msg}`)
      }
    }
  }

  /**
   * 配置开关关闭:永远视作持锁者,等价于旧行为 (每窗口各弹 toast)。
   */
  disable(): void {
    this.disabled = true
    this.amLeader = true
  }

  /**
   * 配置开关打开:恢复正常 leader-election 行为。
   * 立即重跑一次 acquire 评估当前真实持锁状态,否则 amLeader 会沿用 disable 期间的 true 值。
   */
  enable(): void {
    this.disabled = false
    this.tryAcquireNow()
  }

  // ---- 内部 ----

  private tick(): void {
    if (!this.active) return  // 未聚焦:不做任何动作
    if (this.disabled) return
    this.attemptAcquire()
  }

  private attemptAcquire(): boolean {
    try {
      const existing = this.readLock()
      // 文件不存在 (ENOENT) / 不可读 (EACCES) / 解析失败 / 字段缺失 → 视为无主
      if (existing === null) {
        this.writeLock()
        this.amLeader = true
        return true
      }
      // 跨主机隔离 (R8):不同 host 视为无主
      if (existing.host !== this.host) {
        this.writeLock()
        this.amLeader = true
        return true
      }
      // 同主机不同 pid:看心跳是否过期
      if (existing.pid !== this.pid) {
        const age = this.clock() - existing.heartbeat
        if (age > this.staleAfterMs) {
          // 过期 → 接管
          this.writeLock()
          this.amLeader = true
          return true
        }
        // 仍鲜活 → 我们是 follower
        this.amLeader = false
        this.acquiredAt = null
        return false
      }
      // 同主机同 pid → 续约
      this.writeLock()
      this.amLeader = true
      return true
    } catch (e) {
      // 任何非预期异常 → fail-open (F8):本进程视为持锁者
      console.warn(`[claude-task-monitor] leaderLock acquire failed, falling back to leader: ${formatErrorMessage(e)}`)
      this.amLeader = true
      return true
    }
  }

  private readLock(): LockPayload | null {
    let raw: string
    try {
      raw = fs.readFileSync(this.lockPath, 'utf8')
    } catch {
      // ENOENT / EACCES 等:视为无主
      return null
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // 损坏内容:fail-open 视为无主 → 覆盖
      return null
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const obj = parsed as Record<string, unknown>
    if (typeof obj.pid !== 'number') return null
    if (typeof obj.host !== 'string') return null
    if (typeof obj.acquiredAt !== 'number') return null
    if (typeof obj.heartbeat !== 'number') return null
    return {
      pid: obj.pid,
      host: obj.host,
      acquiredAt: obj.acquiredAt,
      heartbeat: obj.heartbeat,
    }
  }

  private writeLock(): void {
    const now = this.clock()
    if (this.acquiredAt === null) this.acquiredAt = now
    const payload: LockPayload = {
      pid: this.pid,
      host: this.host,
      acquiredAt: this.acquiredAt,
      heartbeat: now,
    }
    fs.writeFileSync(this.lockPath, JSON.stringify(payload))
  }
}
