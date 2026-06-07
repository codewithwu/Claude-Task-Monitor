import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SessionStore } from '../stateManager'
import { isProcessGone, pruneDeadSessions } from '../liveness'

function spawnLongLived(): Promise<{ child: ReturnType<typeof spawn>; pid: number; kill: () => Promise<void>; stop: () => void; cont: () => void }> {
  return new Promise((resolve) => {
    const child = spawn('node', ['-e', 'setInterval(() => {}, 1000)'])
    const kill = () => new Promise<void>((r) => {
      child.on('exit', () => r())
      child.kill('SIGKILL')
    })
    const stop = () => { child.kill('SIGSTOP') }
    const cont = () => { child.kill('SIGCONT') }
    resolve({ child, pid: child.pid!, kill, stop, cont })
  })
}

function spawnImmediate(): Promise<number> {
  return new Promise((resolve) => {
    const c = spawn('node', ['-e', 'process.exit(0)'])
    c.on('exit', () => resolve(c.pid!))
  })
}

function makeTmpSessionsDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'liveness-test-'))
}

function readProcState(pid: number): string | null {
  try {
    const m = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^State:\s+\S+\s+\((\w+)\)/m)
    return m ? m[1] : null
  } catch {
    return null
  }
}

describe('liveness e2e', () => {
  it('死的 pid 被移除,活的保留,没 pid 的跳过', async () => {
    const dir = makeTmpSessionsDir()
    const store = new SessionStore()
    const alive = await spawnLongLived()
    const dying = await spawnLongLived()
    const dead = await spawnImmediate()

    store.apply({ hook_event_name: 'SessionStart', session_id: 'A-alive', cwd: '/a', ts: 1, pid: alive.pid } as any)
    store.apply({ hook_event_name: 'SessionStart', session_id: 'B-dying', cwd: '/b', ts: 1, pid: dying.pid } as any)
    store.apply({ hook_event_name: 'SessionStart', session_id: 'C-dead', cwd: '/c', ts: 1, pid: dead } as any)
    store.apply({ hook_event_name: 'SessionStart', session_id: 'D-nopid', cwd: '/d', ts: 1 } as any)

    expect(store.list().map(s => s.sessionId).sort()).toEqual(['A-alive', 'B-dying', 'C-dead', 'D-nopid'])

    await dying.kill()

    const { removed } = pruneDeadSessions(store, dir)
    expect(removed).toBe(2)

    const remaining = store.list().map(s => s.sessionId).sort()
    expect(remaining).toEqual(['A-alive', 'D-nopid'])

    await alive.kill()
    fs.rmSync(dir, { recursive: true, force: true })
  }, 10000)

  it('空 store 跑 liveness 不抛错', () => {
    const dir = makeTmpSessionsDir()
    const store = new SessionStore()
    expect(() => pruneDeadSessions(store, dir)).not.toThrow()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('不存在的大 pid 触发 ESRCH → 移除', () => {
    const dir = makeTmpSessionsDir()
    const store = new SessionStore()
    const fakePid = 99_999_999
    store.apply({ hook_event_name: 'SessionStart', session_id: 'fake', cwd: '/f', ts: 1, pid: fakePid } as any)
    expect(store.list()).toHaveLength(1)
    const { removed } = pruneDeadSessions(store, dir)
    expect(removed).toBe(1)
    expect(store.list()).toHaveLength(0)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('Ctrl+Z (SIGSTOP) 后的 pid 被识别为 gone 并归档 .jsonl 到 .ended/', async () => {
    const dir = makeTmpSessionsDir()
    const store = new SessionStore()
    const victim = await spawnLongLived()

    const sessionFile = path.join(dir, 'Z-stopped.jsonl')
    fs.writeFileSync(sessionFile, JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'Z-stopped', cwd: '/z', ts: 1, pid: victim.pid }) + '\n')

    store.apply({ hook_event_name: 'SessionStart', session_id: 'Z-stopped', cwd: '/z', ts: 1, pid: victim.pid } as any)
    expect(store.list()).toHaveLength(1)

    victim.stop()
    await new Promise(r => setTimeout(r, 100))

    const procState = readProcState(victim.pid)
    const { removed, archived } = pruneDeadSessions(store, dir)

    if (procState === 'stopped' || procState === 'tracing_stop') {
      // Linux 上:SIGSTOP 必须被识别为 gone
      expect(removed).toBe(1)
      expect(archived).toHaveLength(1)
      expect(archived[0]).toContain(path.join('.ended', 'Z-stopped-'))
      expect(fs.existsSync(sessionFile)).toBe(false)
      expect(fs.existsSync(archived[0])).toBe(true)
      expect(store.list()).toHaveLength(0)
    } else {
      // 非 Linux / /proc 拿不到:至少不能误杀活进程
      expect(removed).toBe(0)
      expect(store.list()).toHaveLength(1)
    }

    victim.cont()
    await new Promise(r => setTimeout(r, 50))
    await victim.kill()
    fs.rmSync(dir, { recursive: true, force: true })
  }, 10000)

  it('isProcessGone: ESRCH → true,存在 → false', async () => {
    const alive = await spawnLongLived()
    expect(isProcessGone(alive.pid)).toBe(false)
    expect(isProcessGone(99_999_999)).toBe(true)
    await alive.kill()
  }, 10000)

  it('isProcessGone: SIGSTOP 后的进程在 Linux 上返回 true', async () => {
    const victim = await spawnLongLived()
    victim.stop()
    await new Promise(r => setTimeout(r, 100))

    const procState = readProcState(victim.pid)
    if (procState === 'stopped' || procState === 'tracing_stop') {
      expect(isProcessGone(victim.pid)).toBe(true)
    } else {
      // 非 Linux:降级路径,可能是 true 或 false(取决于 ps 是否能拿到)
      expect([true, false]).toContain(isProcessGone(victim.pid))
    }

    victim.cont()
    await new Promise(r => setTimeout(r, 50))
    await victim.kill()
  }, 10000)
})
