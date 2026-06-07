import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { SessionStore } from '../stateManager'

// 复现 src/extension.ts 里 pruneDeadSessions 的逻辑(那个函数没 export)
function pruneDeadSessions(store: SessionStore): number {
  let removed = 0
  for (const s of store.list()) {
    if (s.pid === undefined) continue
    try {
      process.kill(s.pid, 0)
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code === 'ESRCH') {
        store.removeByPid(s.pid)
        removed++
      }
    }
  }
  return removed
}

function spawnLongLived(): Promise<{ child: ReturnType<typeof spawn>; pid: number; kill: () => Promise<void> }> {
  return new Promise((resolve) => {
    const child = spawn('node', ['-e', 'setInterval(() => {}, 1000)'])
    const kill = () => new Promise<void>((r) => {
      child.on('exit', () => r())
      child.kill('SIGKILL')
    })
    resolve({ child, pid: child.pid!, kill })
  })
}

function spawnImmediate(): Promise<number> {
  return new Promise((resolve) => {
    const c = spawn('node', ['-e', 'process.exit(0)'])
    c.on('exit', () => resolve(c.pid!))
  })
}

describe('liveness e2e', () => {
  it('死的 pid 被移除,活的保留,没 pid 的跳过', async () => {
    const store = new SessionStore()
    const alive = await spawnLongLived()
    const dying = await spawnLongLived()
    const dead = await spawnImmediate()   // 同步立即死,等 exit 回调拿到 pid

    // 三个 SessionStart 带 pid + 一个不带
    store.apply({ hook_event_name: 'SessionStart', session_id: 'A-alive', cwd: '/a', ts: 1, pid: alive.pid } as any)
    store.apply({ hook_event_name: 'SessionStart', session_id: 'B-dying', cwd: '/b', ts: 1, pid: dying.pid } as any)
    store.apply({ hook_event_name: 'SessionStart', session_id: 'C-dead', cwd: '/c', ts: 1, pid: dead } as any)
    store.apply({ hook_event_name: 'SessionStart', session_id: 'D-nopid', cwd: '/d', ts: 1 } as any)

    expect(store.list().map(s => s.sessionId).sort()).toEqual(['A-alive', 'B-dying', 'C-dead', 'D-nopid'])

    // kill B
    await dying.kill()

    // 跑 liveness
    const removed = pruneDeadSessions(store)
    expect(removed).toBe(2)   // B + C

    const remaining = store.list().map(s => s.sessionId).sort()
    expect(remaining).toEqual(['A-alive', 'D-nopid'])

    // 清理
    await alive.kill()
  }, 10000)

  it('空 store 跑 liveness 不抛错', () => {
    const store = new SessionStore()
    expect(() => pruneDeadSessions(store)).not.toThrow()
  })

  it('不存在的大 pid 触发 ESRCH → 移除', () => {
    const store = new SessionStore()
    const fakePid = 99_999_999   // Linux pid_max 范围内,确认 ESRCH
    store.apply({ hook_event_name: 'SessionStart', session_id: 'fake', cwd: '/f', ts: 1, pid: fakePid } as any)
    expect(store.list()).toHaveLength(1)
    const removed = pruneDeadSessions(store)
    expect(removed).toBe(1)
    expect(store.list()).toHaveLength(0)
  })
})
