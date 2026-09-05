// findClaudeTerminal 单测 (09-06 jump-to-that-terminal):
//   - mock vscode.window.terminals 返 fake terminal 数组
//   - mock child_process.execFileSync 让 walkUpToComm (走 darwin 分支) 用我们的 fake 表
//   - 覆盖 0 terminal / 无 pid / 单命中 / 多命中 cwd 排序 / 并列 / 全不命中 /
//     s.pid undefined / processId 慢响应超时 等场景
//
// 关键设定:
//   s.pid = 9999 = CLAUDE_PID —— 这是「comm=claude」的祖先 PID,不是 shell PID。
//   fake 进程表里的 shell PID (2000/3000/...) 必须 PPID 链最终指向 9999,
//   walkUpToComm 才能返 9999,跟 s.pid 比对命中。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock child_process.execFileSync 走 darwin 分支 (process.platform='darwin'),
// 让 walkUpToComm 读我们控制的进程表。同 liveness.test.ts:9-14 / pidAncestor.test.ts:9-14。
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) }
})

// mock vscode 桩:findClaudeTerminal 只用 vscode.window.terminals 字段。
// terminals 在每个测试 setTerminals() 重定义,这里默认空数组。
vi.mock('vscode', () => ({
  window: { terminals: [] },
  Uri: { file: (p: string) => ({ fsPath: p, path: p, scheme: 'file' }) }
}))

import { execFileSync } from 'node:child_process'
import * as vscode from 'vscode'
import { findClaudeTerminal } from '../util/findClaudeTerminal.js'
import type { SessionState } from '../types.js'

// ── fake terminal ────────────────────────────────────────────────────────
// vscode.Terminal 是抽象类,不能直接 new。用一个最小 stub 接口 ——
interface FakeTerminal {
  readonly name: string
  readonly creationOptions: unknown
  readonly processId: Thenable<number | undefined> | Promise<number | undefined> | number | undefined
  show(): void
}

function makeFakeTerminal(opts: {
  name?: string
  pid?: number | Promise<number | undefined> | undefined
  cwd?: string | vscode.Uri
}): FakeTerminal {
  const cwd = opts.cwd
  return {
    name: opts.name ?? 'fake',
    creationOptions: { cwd } as unknown as vscode.TerminalOptions,
    // processId 必须返 Thenable<number|undefined>;Promise 满足 Thenable 约束
    processId: Promise.resolve(opts.pid) as unknown as Thenable<number | undefined>,
    show: () => {}
  }
}

function setTerminals(terms: FakeTerminal[]): void {
  Object.defineProperty(vscode.window, 'terminals', {
    value: terms,
    configurable: true,
    writable: true
  })
}

// ── walkUpToComm fake table ──────────────────────────────────────────────
// 在 darwin 分支:execFileSync('ps', ['-o', 'comm=', '-p', pid]) 返 comm,
//                execFileSync('ps', ['-o', 'ppid=', '-p', pid]) 返 ppid。
// 表语义:每行 = { comm, ppid } —— ppid 是 PARENT 的 pid。
// 设 platform='darwin' 强制走 ps 路径,不读真 /proc。
//
// CLAUDE_PID 必须是 comm='claude' 的那个 PID,跟 s.pid 对得上。
type Row = { comm: string; ppid: number }
function setFakeProcessTable(table: Record<number, Row>): void {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
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

// ── 测试 ──────────────────────────────────────────────────────────────────

const CLAUDE_PID = 9999

function makeSession(pid: number | undefined, cwd = '/home/user/proj'): SessionState {
  return {
    sessionId: 's1',
    cwd,
    status: 'idle',
    stateChangedAt: 0,
    lastUserPrompt: '',
    currentTool: null,
    fileOffset: 0,
    pid
  }
}

describe('findClaudeTerminal', () => {
  let origPlatform: NodeJS.Platform

  beforeEach(() => {
    origPlatform = process.platform
    vi.mocked(execFileSync).mockReset()
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true })
  })

  it('0 个 terminal → 返 null', async () => {
    setTerminals([])
    const r = await findClaudeTerminal(makeSession(CLAUDE_PID))
    expect(r).toBeNull()
  })

  it('1 个 terminal 但 processId undefined → 返 null', async () => {
    const term = makeFakeTerminal({ pid: undefined })
    setTerminals([term])
    const r = await findClaudeTerminal(makeSession(CLAUDE_PID))
    expect(r).toBeNull()
  })

  it('1 个 terminal 命中 + cwd 匹配 → 返该 terminal', async () => {
    // shell 2000 → claude(9999):2000 comm=bash,ppid=9999;9999 comm=claude,ppid=1
    setFakeProcessTable({
      2000: { comm: 'bash',   ppid: CLAUDE_PID },
      9999: { comm: 'claude', ppid: 1 }
    })
    const term = makeFakeTerminal({ pid: 2000, cwd: '/home/user/proj' })
    setTerminals([term])
    const r = await findClaudeTerminal(makeSession(CLAUDE_PID))
    expect(r).toBe(term)
  })

  it('2 个 terminal 都命中,一个 cwd 匹配一个不匹配 → 返 cwd 匹配那个', async () => {
    // 两个 shell 都最终指向 CLAUDE_PID
    setFakeProcessTable({
      2000: { comm: 'bash',   ppid: CLAUDE_PID },
      3000: { comm: 'bash',   ppid: CLAUDE_PID },
      9999: { comm: 'claude', ppid: 1 }
    })
    const matchCwd = makeFakeTerminal({ name: 'match', pid: 2000, cwd: '/home/user/proj' })
    const diffCwd = makeFakeTerminal({ name: 'diff',  pid: 3000, cwd: '/tmp/other' })
    setTerminals([matchCwd, diffCwd])
    const r = await findClaudeTerminal(makeSession(CLAUDE_PID))
    expect(r).toBe(matchCwd)
  })

  it('2 个 terminal 全 cwd 匹配 → 返第一个 (并列降级)', async () => {
    setFakeProcessTable({
      2000: { comm: 'bash',   ppid: CLAUDE_PID },
      3000: { comm: 'bash',   ppid: CLAUDE_PID },
      9999: { comm: 'claude', ppid: 1 }
    })
    const first = makeFakeTerminal({ name: 'first', pid: 2000, cwd: '/home/user/proj' })
    const second = makeFakeTerminal({ name: 'second', pid: 3000, cwd: '/home/user/proj' })
    setTerminals([first, second])
    const r = await findClaudeTerminal(makeSession(CLAUDE_PID))
    expect(r).toBe(first)
  })

  it('全部未命中 (PID 链 walk 不返 s.pid) → 返 null', async () => {
    // 2000 的祖先是 8888(不是 CLAUDE_PID)
    setFakeProcessTable({
      2000: { comm: 'node',   ppid: 8888 },
      8888: { comm: 'claude', ppid: 1 }
    })
    const term = makeFakeTerminal({ pid: 2000 })
    setTerminals([term])
    const r = await findClaudeTerminal(makeSession(CLAUDE_PID))
    expect(r).toBeNull()
  })

  it('s.pid undefined → 短路返 null,不调 walkUpToComm', async () => {
    // 不设 fake exec —— 若 walkUpToComm 被调用,vi.mocked(execFileSync).mockReset() 后
    // 会落到 actual.execFileSync 真去 fork ps,可能 hang 或失败。这里靠 spy
    // 是否被调用来断言短路。
    const term = makeFakeTerminal({ pid: 2000 })
    setTerminals([term])
    const r = await findClaudeTerminal(makeSession(undefined))
    expect(r).toBeNull()
    // execFileSync 一次都不该被调 (短路)
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('processId 慢响应 (Promise 不 resolve) → 200ms 后超时,整体不挂', async () => {
    // 返一个永远不 resolve 的 Promise —— Promise.race 的 200ms timeout 兜底
    const slow: FakeTerminal = {
      name: 'slow',
      creationOptions: {} as any,
      processId: new Promise<number | undefined>(() => {}),  // never resolves
      show: () => {}
    }
    setTerminals([slow])
    const start = Date.now()
    const r = await findClaudeTerminal(makeSession(CLAUDE_PID))
    const elapsed = Date.now() - start
    expect(r).toBeNull()
    // 单点 timeout 200ms 加上 walkUpToComm 时间,整体 < 1s
    expect(elapsed).toBeLessThan(1000)
  }, 3000)

  it('多个 terminal 混合命中 / 未命中:精确匹配优先于 PID 命中', async () => {
    // A shell=2000 → claude, cwd=/home/user/proj (PID 命中 + cwd 匹配 = 2)
    // B shell=3000 → claude, cwd=/tmp/other       (PID 命中 + cwd 不匹配 = 1)
    // C shell=4000 → node(死链), cwd=/home/user/proj (PID 不命中,虽然 cwd 匹配)
    setFakeProcessTable({
      2000: { comm: 'bash',   ppid: CLAUDE_PID },
      3000: { comm: 'bash',   ppid: CLAUDE_PID },
      4000: { comm: 'node',   ppid: 5555 },  // 走到 5555,不是 CLAUDE_PID
      9999: { comm: 'claude', ppid: 1 }
    })
    const a = makeFakeTerminal({ name: 'a', pid: 2000, cwd: '/home/user/proj' })
    const b = makeFakeTerminal({ name: 'b', pid: 3000, cwd: '/tmp/other' })
    const c = makeFakeTerminal({ name: 'c', pid: 4000, cwd: '/home/user/proj' })
    setTerminals([a, b, c])
    const r = await findClaudeTerminal(makeSession(CLAUDE_PID))
    expect(r).toBe(a)  // A 拿满分 2;B 拿 1;C 根本没进 candidates
  })

  it('cwd 是 Uri 对象(有 fsPath)→ 也能匹配', async () => {
    setFakeProcessTable({
      2000: { comm: 'bash',   ppid: CLAUDE_PID },
      9999: { comm: 'claude', ppid: 1 }
    })
    const term = makeFakeTerminal({ pid: 2000, cwd: vscode.Uri.file('/home/user/proj') })
    setTerminals([term])
    const r = await findClaudeTerminal(makeSession(CLAUDE_PID, '/home/user/proj'))
    expect(r).toBe(term)
  })

  it('cwd 完全缺失(terminal 创建时未指定 cwd) → 命中但 cwd 评分 = 1', async () => {
    // createTerminal({}) 不传 cwd —— 我们 fake terminal 的 creationOptions 也没 cwd
    setFakeProcessTable({
      2000: { comm: 'bash',   ppid: CLAUDE_PID },
      9999: { comm: 'claude', ppid: 1 }
    })
    const term = makeFakeTerminal({ pid: 2000 /* cwd undefined */ })
    setTerminals([term])
    const r = await findClaudeTerminal(makeSession(CLAUDE_PID))
    expect(r).toBe(term)
  })
})
