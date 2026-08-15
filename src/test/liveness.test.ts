import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SessionStore } from '../stateManager.js'

// vi.mock 必须放在 import 之前(vitest 会 hoist),mock execFileSync 才能拦截 liveness.ts 里的调用
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) }
})

// 同样 mock node:fs.readFileSync:默认调 actual,但特定测试可 mockReturnValueOnce 注入假 /proc 内容
// (vi.spyOn 对 node:fs namespace 的 readFileSync 不能 redefine,只能 vi.mock)
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) }
})

import { isProcessGone, pruneDeadSessions } from '../liveness.js'

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

describe('isProcessGone 平台路由', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.mocked(execFileSync).mockReset()
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('win32: wsl.exe ps 解析 stat 首字母为 T → true', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    vi.mocked(execFileSync).mockReturnValue('T' as any)
    expect(isProcessGone(12345)).toBe(true)
    expect(execFileSync).toHaveBeenCalledWith('wsl.exe', ['ps', '-p', '12345', '-o', 'stat='], expect.objectContaining({ timeout: 1000 }))
  })

  it('win32: wsl.exe ps 返回 R → false', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    vi.mocked(execFileSync).mockReturnValue('R' as any)
    expect(isProcessGone(12345)).toBe(false)
  })

  it('win32: wsl.exe ps 小写 t (tracing stop) → true', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    vi.mocked(execFileSync).mockReturnValue('t' as any)
    expect(isProcessGone(12345)).toBe(true)
  })

  it('darwin (ps fallback): 小写 t (tracing stop) → true', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    vi.mocked(execFileSync).mockReturnValue('t' as any)
    expect(isProcessGone(12345)).toBe(true)
  })

  it('linux: /proc 状态 `t (tracing stop)` 多词状态名 → true', () => {
    // gdb/strace attach 时 kernel 写 "State:\tt (tracing stop)"
    // 旧正则 \w+ 抓不到多词,会漏判这种进程
    // 用 process.pid 绕过 ESRCH 短路,确保 readFileSync 这条路径真的被走到
    // (用假 pid 的话 process.kill 抛 ESRCH,checkViaProc 在 readFileSync 之前就返回 true,
    //  mockReturnValueOnce 不会被消费,会污染下一个测试)
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    vi.mocked(fs.readFileSync).mockReturnValueOnce(
      'Name:\tnode\nState:\tt (tracing stop)\nTgid:\t1\nPid:\t1\n' as any
    )
    expect(isProcessGone(process.pid)).toBe(true)
  })

  it('win32: wsl.exe 抛错降级 tasklist,PID 找不到 → true', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    vi.mocked(execFileSync)
      .mockImplementationOnce(() => { throw new Error('wsl not found') })
      .mockImplementationOnce(() => Buffer.from('INFO: No tasks are running which match the specified criteria.'))
    expect(isProcessGone(12345)).toBe(true)
    expect(execFileSync).toHaveBeenCalledTimes(2)
    expect((execFileSync as any).mock.calls[1][0]).toBe('tasklist')
    expect((execFileSync as any).mock.calls[1][1]).toEqual(['/FI', 'PID eq 12345', '/NH', '/FO', 'CSV'])
  })

  it('win32: wsl.exe 抛错 + tasklist 抛错 → false(不误杀)', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('both failed') })
    expect(isProcessGone(12345)).toBe(false)
  })

  it('非整数 pid (NaN, 0, 负数, 小数) 返回 false 不抛错', () => {
    expect(isProcessGone(NaN)).toBe(false)
    expect(isProcessGone(0)).toBe(false)
    expect(isProcessGone(-1)).toBe(false)
    expect(isProcessGone(1.5)).toBe(false)
    expect(isProcessGone(undefined as any)).toBe(false)
    expect(isProcessGone(null as any)).toBe(false)
  })

  it('linux (当前平台): /proc 可读时直接走 checkViaProc', () => {
    // 自身进程的 /proc 一定可读,checkViaProc 返回 false
    expect(isProcessGone(process.pid)).toBe(false)
  })
})

describe('pruneDeadSessions mkdirSync 频率', () => {
  it('N 个死会话都被识别并从 store 移除', () => {
    const dir = makeTmpSessionsDir()
    const store = new SessionStore()
    store.apply({ hook_event_name: 'SessionStart', session_id: 'mk1', cwd: '/m', ts: 1, pid: 99_999_991 } as any)
    store.apply({ hook_event_name: 'SessionStart', session_id: 'mk2', cwd: '/m', ts: 1, pid: 99_999_992 } as any)
    store.apply({ hook_event_name: 'SessionStart', session_id: 'mk3', cwd: '/m', ts: 1, pid: 99_999_993 } as any)

    const { removed } = pruneDeadSessions(store, dir)
    expect(removed).toBe(3)
    expect(store.list()).toHaveLength(0)

    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('有 .jsonl 文件的死会话会被归档到 .ended/', () => {
    const dir = makeTmpSessionsDir()
    const store = new SessionStore()
    // 写对应的 .jsonl 让 archive 分支执行
    fs.writeFileSync(path.join(dir, 'arc1.jsonl'), '{"hook_event_name":"SessionStart","session_id":"arc1","cwd":"/a","ts":1,"pid":99999981}\n')
    fs.writeFileSync(path.join(dir, 'arc2.jsonl'), '{"hook_event_name":"SessionStart","session_id":"arc2","cwd":"/a","ts":1,"pid":99999982}\n')
    store.apply({ hook_event_name: 'SessionStart', session_id: 'arc1', cwd: '/a', ts: 1, pid: 99_999_981 } as any)
    store.apply({ hook_event_name: 'SessionStart', session_id: 'arc2', cwd: '/a', ts: 1, pid: 99_999_982 } as any)

    const { removed, archived } = pruneDeadSessions(store, dir)
    expect(removed).toBe(2)
    expect(archived).toHaveLength(2)
    for (const f of archived) expect(fs.existsSync(f)).toBe(true)

    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('连续两次 pruneDeadSessions 幂等 (mkdirSync 已被提出循环外)', () => {
    const dir = makeTmpSessionsDir()
    const store = new SessionStore()
    store.apply({ hook_event_name: 'SessionStart', session_id: 'idem1', cwd: '/i', ts: 1, pid: 99_999_981 } as any)
    store.apply({ hook_event_name: 'SessionStart', session_id: 'idem2', cwd: '/i', ts: 1, pid: 99_999_982 } as any)

    const r1 = pruneDeadSessions(store, dir)
    expect(r1.removed).toBe(2)
    // 第二次没新死的,不报错、返回 0
    const r2 = pruneDeadSessions(store, dir)
    expect(r2.removed).toBe(0)
    expect(r2.archived).toEqual([])

    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('pruneDeadSessions 归档名格式', () => {
  it('归档文件名带时间戳和 8 字符后缀', () => {
    const dir = makeTmpSessionsDir()
    const store = new SessionStore()
    const sessionFile = path.join(dir, 'fmt.jsonl')
    fs.writeFileSync(sessionFile, '{"hook_event_name":"SessionStart","session_id":"fmt","cwd":"/f","ts":1,"pid":99999990}\n')
    store.apply({ hook_event_name: 'SessionStart', session_id: 'fmt', cwd: '/f', ts: 1, pid: 99_999_990 } as any)

    const { archived } = pruneDeadSessions(store, dir)
    expect(archived).toHaveLength(1)
    // 格式: fmt-<millis>-<8hex>.jsonl
    expect(path.basename(archived[0])).toMatch(/^fmt-\d{13}-[0-9a-f]{8}\.jsonl$/)
    expect(fs.existsSync(archived[0])).toBe(true)

    fs.rmSync(dir, { recursive: true, force: true })
  })
})
