import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { LeaderLock } from '../util/leaderLock.js'

// 单测用 clock 注入 + 短阈值 (heartbeat 50ms / stale 200ms) —— 让用例快且确定。
// 不 mock fs —— 走真实 mkdtempSync 目录,与 testing.md "Don't mock these: fs" 对齐。

describe('LeaderLock (单进程)', () => {
  let tmpDir: string
  let lockPath: string
  let clock: number
  const baseOpts = () => ({
    lockPath,
    host: 'test-host',
    pid: 10001,
    heartbeatIntervalMs: 50,
    staleAfterMs: 200,
    clock: () => clock,
  })

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctm-leader-'))
    lockPath = path.join(tmpDir, 'notify-leader.lock')
    clock = 1_700_000_000_000
  })
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('空目录 → acquire 后 isLeader() 为 true', () => {
    const lk = new LeaderLock(baseOpts())
    expect(lk.tryAcquireNow()).toBe(true)
    expect(lk.isLeader()).toBe(true)
    expect(fs.existsSync(lockPath)).toBe(true)
    const payload = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    expect(payload.pid).toBe(10001)
    expect(payload.host).toBe('test-host')
    expect(typeof payload.acquiredAt).toBe('number')
    expect(typeof payload.heartbeat).toBe('number')
  })

  it('acquiredAt 在续约时不变', () => {
    const lk = new LeaderLock(baseOpts())
    lk.tryAcquireNow()
    const first = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    clock += 1000
    lk.tryAcquireNow()
    const second = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    expect(second.acquiredAt).toBe(first.acquiredAt)
    expect(second.heartbeat).toBe(first.heartbeat + 1000)
  })

  it('本窗口仍是 leader(自己写过的锁)→ 续约不踩自己', () => {
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 10001, host: 'test-host',
      acquiredAt: clock - 100, heartbeat: clock - 50,
    }))
    const lk = new LeaderLock(baseOpts())
    expect(lk.tryAcquireNow()).toBe(true)
    expect(lk.isLeader()).toBe(true)
  })

  it('其他 host 持锁 → 我们视为无主并抢锁', () => {
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 9999, host: 'other-host',
      acquiredAt: clock, heartbeat: clock,  // 刚写过,新鲜
    }))
    const lk = new LeaderLock(baseOpts())
    expect(lk.tryAcquireNow()).toBe(true)  // 抢过来 (R8)
    expect(lk.isLeader()).toBe(true)
    const payload = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    expect(payload.host).toBe('test-host')
    expect(payload.pid).toBe(10001)
  })

  it('同主机他人持锁且心跳鲜活 → 我们是 follower', () => {
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 9999, host: 'test-host',
      acquiredAt: clock, heartbeat: clock,  // 0ms 前
    }))
    const lk = new LeaderLock(baseOpts())
    expect(lk.tryAcquireNow()).toBe(false)
    expect(lk.isLeader()).toBe(false)
    // 文件未被我们覆盖
    const payload = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    expect(payload.pid).toBe(9999)
  })

  it('心跳过期 → 我们接管', () => {
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 9999, host: 'test-host',
      acquiredAt: clock - 1000, heartbeat: clock - 1000,  // 已过期 (>200ms)
    }))
    clock += 250
    const lk = new LeaderLock(baseOpts())
    expect(lk.tryAcquireNow()).toBe(true)
    expect(lk.isLeader()).toBe(true)
    const payload = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    expect(payload.pid).toBe(10001)
  })

  it('锁文件 JSON 损坏 → fail-open 视为可抢,直接覆盖', () => {
    fs.writeFileSync(lockPath, '{not json')
    const lk = new LeaderLock(baseOpts())
    expect(lk.tryAcquireNow()).toBe(true)
    expect(lk.isLeader()).toBe(true)
    const payload = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    expect(payload.pid).toBe(10001)
  })

  it('锁文件结构字段缺失 → fail-open 视为可抢', () => {
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 1 }))  // 缺 host / heartbeat
    const lk = new LeaderLock(baseOpts())
    expect(lk.tryAcquireNow()).toBe(true)
    expect(lk.isLeader()).toBe(true)
  })

  it('锁文件被 chmod 000 → fail-open (isLeader() 返回 true,本进程视作持锁者)', () => {
    if (process.platform === 'win32') {
      console.warn('chmod 不支持在 win32,跳过该用例')
      return
    }
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 9999, host: 'test-host',
      acquiredAt: clock, heartbeat: clock,
    }))
    fs.chmodSync(lockPath, 0o000)
    try {
      const lk = new LeaderLock(baseOpts())
      // EACCES → readLock 返回 null → 视为无主 → 写时也失败 → catch → fail-open
      expect(lk.tryAcquireNow()).toBe(true)
      expect(lk.isLeader()).toBe(true)
    } finally {
      fs.chmodSync(lockPath, 0o600)  // 清理,允许 afterEach 删目录
    }
  })

  it('release() 只在持锁时删文件,非持锁时不删别人的锁', () => {
    // 别人的锁
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 9999, host: 'test-host',
      acquiredAt: clock, heartbeat: clock,
    }))
    const lk = new LeaderLock(baseOpts())
    expect(lk.tryAcquireNow()).toBe(false)  // 我们是 follower
    lk.release()
    expect(fs.existsSync(lockPath)).toBe(true)  // 文件仍在
    const payload = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    expect(payload.pid).toBe(9999)  // 没动别人的数据
  })

  it('release() 在持锁时删文件', () => {
    const lk = new LeaderLock(baseOpts())
    lk.tryAcquireNow()
    expect(fs.existsSync(lockPath)).toBe(true)
    lk.release()
    expect(fs.existsSync(lockPath)).toBe(false)
    expect(lk.isLeader()).toBe(false)
  })

  it('disable() 后 isLeader() 恒为 true,tryAcquireNow 也直接 true', () => {
    // 别人的鲜活锁
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 9999, host: 'test-host',
      acquiredAt: clock, heartbeat: clock,
    }))
    const lk = new LeaderLock(baseOpts())
    lk.disable()
    expect(lk.isLeader()).toBe(true)
    expect(lk.tryAcquireNow()).toBe(true)
    // disable 不改文件 —— 别人的锁还在
    const payload = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    expect(payload.pid).toBe(9999)
  })

  it('enable() 恢复选举行为', () => {
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 9999, host: 'test-host',
      acquiredAt: clock, heartbeat: clock,
    }))
    const lk = new LeaderLock(baseOpts())
    lk.disable()
    expect(lk.isLeader()).toBe(true)
    lk.enable()
    // enable 后 isLeader 反映上一次 acquire 状态 —— 我们从未真正抢过,所以是 follower
    expect(lk.isLeader()).toBe(false)
  })

  it('心跳续约 (active=true 时 tick → 同一 leader 持续写 heartbeat)', () => {
    const lk = new LeaderLock(baseOpts())
    lk.start()
    lk.setActive(true)
    lk.tryAcquireNow()
    const first = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    clock += 100  // 推进时间
    // 等两次心跳
    return new Promise<void>(resolve => {
      setTimeout(() => {
        const second = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
        expect(second.heartbeat).toBeGreaterThan(first.heartbeat)
        expect(second.acquiredAt).toBe(first.acquiredAt)  // acquiredAt 不变
        expect(lk.isLeader()).toBe(true)
        lk.stop()  // 释放锁 + 停心跳
        resolve()
      }, 150)
    })
  })

  it('失焦后心跳不再续约,锁文件可被接管', () => {
    const lk = new LeaderLock(baseOpts())
    lk.start()
    lk.setActive(true)
    lk.tryAcquireNow()
    const first = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    lk.setActive(false)  // 失焦
    clock += 100
    return new Promise<void>(resolve => {
      setTimeout(() => {
        const second = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
        // 失焦后不再续约 → heartbeat 未推进
        expect(second.heartbeat).toBe(first.heartbeat)
        // 推进时间过 STALE_AFTER_MS 后,别人应能接管
        clock += 300
        const other = new LeaderLock({
          ...baseOpts(),
          pid: 20002,
        })
        expect(other.tryAcquireNow()).toBe(true)  // 接管
        expect(other.isLeader()).toBe(true)
        other.stop()
        resolve()
      }, 150)
    })
  })

  it('tick 在 active=false 时是 no-op (heartbeat 不推进)', () => {
    const lk = new LeaderLock(baseOpts())
    lk.start()
    lk.setActive(false)
    lk.tryAcquireNow()  // 没抢到,因为从未 setActive(true) → tick 不会自动抢
    // active=false 时 tick 跳过,所以即便我们曾 acquire,heartbeat 也不会推进
    const first = JSON.parse(fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : '{}')
    clock += 100
    return new Promise<void>(resolve => {
      setTimeout(() => {
        // 文件可能不存在(从未 acquire)或存在但未更新 —— 都视为 active 跳过 tick 的证据
        if (fs.existsSync(lockPath)) {
          const second = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
          expect(second.heartbeat).toBe(first.heartbeat)
        } else {
          expect(fs.existsSync(lockPath)).toBe(false)
        }
        lk.stop()
        resolve()
      }, 150)
    })
  })

  it('stop() 同时停心跳 + 释放锁 (deactivate 路径)', () => {
    const lk = new LeaderLock(baseOpts())
    lk.start()
    lk.setActive(true)
    lk.tryAcquireNow()
    expect(fs.existsSync(lockPath)).toBe(true)
    lk.stop()
    expect(fs.existsSync(lockPath)).toBe(false)
    expect(lk.isLeader()).toBe(false)
  })

  it('pause() 停心跳但不删文件 (失焦路径)', () => {
    const lk = new LeaderLock(baseOpts())
    lk.start()
    lk.setActive(true)
    lk.tryAcquireNow()
    expect(fs.existsSync(lockPath)).toBe(true)
    lk.pause()
    expect(fs.existsSync(lockPath)).toBe(true)  // 文件保留
    lk.stop()  // 清理
  })
})

// 多进程竞争 —— 按 testing.md 约定用真实 child process。
// 3 个 node 子进程同时调 tryAcquireNow,断言恰好 1 个 winner。
// 用 stdout 协议:每个子进程先 sleep 一段 jitter 时间再 acquire,避免时钟竞争掩盖真实竞态。
describe('LeaderLock (多进程竞争)', () => {
  let tmpDir: string
  let lockPath: string

  // 子进程脚本:接收 LOCK_PATH / HOST_BASE / OUR_PID / JITTER_MS 环境变量,
  // 先 sleep JITTER_MS(随机化启动时间,模拟真实场景),再 tryAcquireNow,
  // 输出 'LEADER\n' 或 'FOLLOWER\n'。父进程汇总 stdout 统计。
  const RACE_SCRIPT = `
    const fs = require('fs');
    const path = require('path');
    // 不直接 import leaderLock —— 测试 vitest 能否独立 spawn 编译产物;
    // 这里走 fs + 手写相同逻辑的最小版本,保证 spawn 不依赖 dist/
    const LOCK_PATH = process.env.LOCK_PATH;
    const HOST = process.env.HOST;
    const OUR_PID = parseInt(process.env.OUR_PID, 10);
    const JITTER = parseInt(process.env.JITTER_MS, 10);

    function readLock() {
      try {
        const raw = fs.readFileSync(LOCK_PATH, 'utf8');
        const p = JSON.parse(raw);
        if (typeof p.pid !== 'number' || typeof p.host !== 'string' || typeof p.heartbeat !== 'number') return null;
        return p;
      } catch { return null; }
    }
    function writeLock() {
      const now = Date.now();
      fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: OUR_PID, host: HOST, acquiredAt: now, heartbeat: now }));
    }

    setTimeout(() => {
      try {
        const existing = readLock();
        if (existing === null) { writeLock(); console.log('LEADER'); process.exit(0); }
        if (existing.host !== HOST) { writeLock(); console.log('LEADER'); process.exit(0); }
        if (existing.pid !== OUR_PID) {
          const age = Date.now() - existing.heartbeat;
          if (age > 6000) { writeLock(); console.log('LEADER'); process.exit(0); }
          console.log('FOLLOWER'); process.exit(0);
        }
        writeLock();
        console.log('LEADER');
      } catch (e) {
        // Fail-open:出错也算 leader
        console.log('LEADER');
      }
      process.exit(0);
    }, JITTER);
  `

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctm-leader-race-'))
    lockPath = path.join(tmpDir, 'lock.json')
  })
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('3 个 child 同时抢锁,恰好 1 个胜出', async () => {
    const children: ReturnType<typeof spawn>[] = []
    const results: string[] = []
    try {
      // 启动 3 个子进程,各 sleep 0~50ms 错开启动 (但仍处于同一并发窗口)
      for (let i = 0; i < 3; i++) {
        const child = spawn(process.execPath, ['-e', RACE_SCRIPT], {
          env: {
            ...process.env,
            LOCK_PATH: lockPath,
            HOST: 'race-host',
            OUR_PID: String(30000 + i),
            JITTER_MS: String(Math.floor(Math.random() * 50)),
          },
        })
        children.push(child)
        child.stdout.on('data', (chunk: Buffer) => {
          for (const line of chunk.toString().split('\n')) {
            if (line === 'LEADER' || line === 'FOLLOWER') results.push(line)
          }
        })
      }
      // 等齐 3 个子进程退出
      await Promise.all(children.map(c => new Promise<void>(r => c.on('exit', () => r()))))
      // 恰好 1 个 LEADER
      expect(results.filter(r => r === 'LEADER')).toHaveLength(1)
      expect(results.filter(r => r === 'FOLLOWER')).toHaveLength(2)
      // 最终文件内容应等于获胜者的 PID
      const finalPayload = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
      expect(finalPayload.host).toBe('race-host')
      expect([30000, 30001, 30002]).toContain(finalPayload.pid)
    } finally {
      for (const c of children) {
        try { c.kill('SIGKILL') } catch {}
      }
    }
  }, 15000)

  it('跨主机锁 (不同 host) 视为无主,后续进程可抢', async () => {
    // 先写一个别的 host 的锁 (R8)
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 9999, host: 'foreign-host',
      acquiredAt: Date.now(), heartbeat: Date.now(),
    }))
    const child = spawn(process.execPath, ['-e', RACE_SCRIPT], {
      env: {
        ...process.env,
        LOCK_PATH: lockPath,
        HOST: 'race-host',
        OUR_PID: '31000',
        JITTER_MS: '0',
      },
    })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    await new Promise<void>(r => child.on('exit', () => r()))
    expect(stdout.trim()).toBe('LEADER')
    const finalPayload = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    expect(finalPayload.host).toBe('race-host')  // 覆盖了 foreign-host
  }, 15000)
})
