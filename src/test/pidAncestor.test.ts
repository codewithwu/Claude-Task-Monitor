import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'

// mock execFileSync 让 darwin 分支可被测试覆盖 —— node:child_process
// namespace export 不可重新 define,只能用 vi.mock (跟 liveness.test.ts:9-14 同款)。
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) }
})

import { execFileSync } from 'node:child_process'
import { walkUpToComm } from '../util/pidAncestor.js'

// 复用 hook.test.ts:14-21 的 setSelfComm 模式 —— 改 /proc/self/comm
// 把测试进程伪装成 comm=claude,这样上层进程(如 spawn 出来的 wrapper)
// 在 walkUp 时能命中 'claude'。
function setSelfComm(comm: string): boolean {
  try {
    fs.writeFileSync(`/proc/${process.pid}/comm`, comm)
    return true
  } catch {
    return false
  }
}

describe('walkUpToComm (Linux 真子进程)', () => {
  // macOS 上 setSelfComm 写 /proc/<pid>/comm 会失败 —— 直接 warn 跳过,
  // 跟 hook.test.ts:69-71 风格一致。
  if (process.platform !== 'linux') {
    it.skip('non-Linux: setSelfComm 不可用,跳过真子进程用例', () => {
      console.warn('walkUpToComm 真子进程用例仅 Linux 跑')
    })
    return
  }

  it('起始 PID 本身就是 claude → 直接返回自己', () => {
    if (!setSelfComm('claude')) {
      console.warn('无法修改 /proc/self/comm,跳过(非 Linux)')
      return
    }
    expect(walkUpToComm(process.pid, 'claude')).toBe(process.pid)
  })

  it('spawn 一个子进程,沿 PPID 链向上能找到 claude 祖先', async () => {
    if (!setSelfComm('claude')) {
      console.warn('无法修改 /proc/self/comm,跳过(非 Linux)')
      return
    }
    const child = spawn('node', ['-e', 'setInterval(() => {}, 1000)'])
    try {
      await new Promise(r => setTimeout(r, 50))
      const ancestor = walkUpToComm(child.pid!, 'claude')
      expect(ancestor).toBe(process.pid)
    } finally {
      child.kill('SIGKILL')
    }
  }, 10000)

  it('祖先链无 claude → 返回 null(不会乱返自己)', async () => {
    // 不改自身 comm —— 这条链里没有 comm=claude
    const child = spawn('node', ['-e', 'setInterval(() => {}, 1000)'])
    try {
      await new Promise(r => setTimeout(r, 50))
      const ancestor = walkUpToComm(child.pid!, 'nonexistent-comm-xyz')
      // 关键断言:永不返回 process.pid(测试进程没把 comm 改成 claude)
      expect(ancestor).not.toBe(process.pid)
    } finally {
      child.kill('SIGKILL')
    }
  }, 10000)
})

describe('walkUpToComm 边界', () => {
  it('pid = 0 / 负数 / undefined / 小数 / NaN → 返回 null,不抛', () => {
    expect(walkUpToComm(0, 'claude')).toBeNull()
    expect(walkUpToComm(-1, 'claude')).toBeNull()
    expect(walkUpToComm(1.5, 'claude')).toBeNull()
    expect(walkUpToComm(NaN, 'claude')).toBeNull()
    expect(walkUpToComm(undefined as unknown as number, 'claude')).toBeNull()
    expect(walkUpToComm(null as unknown as number, 'claude')).toBeNull()
  })

  it('target 空字符串 → 返回 null', () => {
    expect(walkUpToComm(process.pid, '')).toBeNull()
  })

  it('不存在的 PID → 返回 null,不抛', () => {
    expect(walkUpToComm(99_999_999, 'claude')).toBeNull()
  })

  it('maxDepth 极小 (1) → 仍不抛', () => {
    expect(() => walkUpToComm(process.pid, 'nonexistent-comm-xyz', { maxDepth: 1 })).not.toThrow()
  })
})

describe('walkUpToComm timeout 截断', () => {
  it('maxDepth 限制循环总层数,即便链很深也会终止', () => {
    // 自身设成 claude:maxDepth=0 不进循环 → null;maxDepth=1 进一次 → 命中
    if (!setSelfComm('claude')) {
      console.warn('无法修改 /proc/self/comm,跳过(非 Linux)')
      return
    }
    expect(walkUpToComm(process.pid, 'claude', { maxDepth: 0 })).toBeNull()
    expect(walkUpToComm(process.pid, 'claude', { maxDepth: 1 })).toBe(process.pid)
  })

  it('Linux 下走真 /proc 路径不抛(回归:跟 hook.sh 同款行为)', () => {
    if (process.platform !== 'linux') return
    expect(() => walkUpToComm(process.pid, 'node')).not.toThrow()
  })
})

describe('walkUpToComm darwin 分支 (mock execFileSync)', () => {
  // 不依赖运行平台:用 vi.mocked(execFileSync) 拦截调 ps 的调用,
  // 验证 darwin 分支里 ps -o comm= / -o ppid= 的解析逻辑。

  let origPlatform: NodeJS.Platform

  beforeEach(() => {
    origPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    vi.mocked(execFileSync).mockReset()
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true })
  })

  // 简易进程表 —— 只为测试 walkUp 的解析逻辑
  //   表语义:每行 = { comm, ppid } —— ppid 是 PARENT 的 pid
  //   walk 时 getPpid(current) = table[current].ppid
  //
  // 返回 string 而非 Buffer:production 里 encoding:'utf8' 会让 execFileSync 返 string,
  // 实现里直接调 .replace() —— Buffer 没有 .replace() 会静默抛 → 被 catch 吞 → 返 null,
  // 测试就看不出问题了。
  function makeFakeExec(table: Record<number, { comm: string; ppid: number }>) {
    vi.mocked(execFileSync).mockImplementation(((
      _cmd: string,
      args: readonly string[]
    ) => {
      // pidAncestor.ts 调 ps -o comm= -p <pid> 或 ps -o ppid= -p <pid>
      // args = ['-o', 'comm=', '-p', '<pid>']  → flag = args[1], pid = args[3]
      const flag = args[1]
      const pid = Number(args[3])
      const row = table[pid]
      if (!row) return '' as any
      if (flag === 'comm=') return (row.comm + '   ') as any  // macOS ps 尾随空格
      return String(row.ppid) as any
    }) as any)
  }

  it('链 node(100) → claude(200) → bash(50) → init(1) → 命中 200', () => {
    makeFakeExec({
      100: { comm: 'node',   ppid: 200 },  // 100 的父是 200
      200: { comm: 'claude', ppid: 50 },
      50:  { comm: 'bash',   ppid: 1 }
    })
    expect(walkUpToComm(100, 'claude')).toBe(200)
  })

  it('链里没有 claude → 返 null,不会乱返某个非匹配的 PID', () => {
    makeFakeExec({
      100: { comm: 'node',  ppid: 50 },
      50:  { comm: 'bash',  ppid: 1 }
    })
    expect(walkUpToComm(100, 'claude')).toBeNull()
  })

  it('起始 PID 本身就是 claude → 返自己,不再往上走', () => {
    makeFakeExec({
      100: { comm: 'claude', ppid: 50 }
    })
    expect(walkUpToComm(100, 'claude')).toBe(100)
  })

  it('macOS ps 尾随空格被 trim 掉', () => {
    // comm 末尾的 '   ' 应被 .replace(/\s+$/, '') 干掉
    makeFakeExec({
      100: { comm: 'claude', ppid: 1 }
    })
    expect(walkUpToComm(100, 'claude')).toBe(100)
  })

  it('链在某层 ppid 拿不到(空输出) → 走 0 路径终止,返 null', () => {
    // 100 的 ppid 拿不到 → getPpid 返 0 → 循环终止
    makeFakeExec({
      100: { comm: 'node',  ppid: 0 }  // ppid=0:Number('0') || 0 = 0
    })
    expect(walkUpToComm(100, 'claude')).toBeNull()
  })
})

describe('walkUpToComm win32 → null', () => {
  // 跨 PID 命名空间不支持,直接返 null。Linux/Darwin 真子进程测试已
  // 覆盖两个分支,这里快速验证「非 linux/darwin 平台直接返 null」。
  let origPlatform: NodeJS.Platform
  beforeEach(() => {
    origPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true })
  })

  it('win32: 即使起始 PID 存在,也返 null(跨 PID namespace 不支持)', () => {
    expect(walkUpToComm(process.pid, 'claude')).toBeNull()
  })
})
