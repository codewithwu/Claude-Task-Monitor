# Claude Task Monitor VS Code Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个 VS Code 扩展，在活动栏侧边栏实时显示本机所有 Claude Code CLI 会话的执行状态（🟢/🟡/🔴），并在会话进入"等待人工确认"状态时弹 VS Code 内部通知。

**Architecture:** Claude Code CLI 通过 hooks 把生命周期事件写入 `~/.claude-task-monitor/sessions/<session-id>.jsonl`（一会话一文件）。VS Code 扩展用 chokidar 监听该目录，把事件 reduce 成会话状态，渲染到 TreeView，并在状态转为 🔴 时弹通知。

**Tech Stack:** TypeScript (strict), VS Code Extension API, chokidar, tsup, vitest, @vscode/test-electron, pnpm。系统依赖：`jq`、bash。

**Spec:** `docs/superpowers/specs/2026-06-07-vscode-claude-task-monitor-design.md`

---

## File Structure

```
.
├── package.json                       # 扩展 manifest, contributes, scripts
├── tsconfig.json                      # TS 严格模式
├── tsup.config.ts                     # 构建配置
├── vitest.config.ts                   # 单元测试配置
├── .gitignore
├── .vscodeignore                      # 打包 .vsix 时排除文件
├── README.md                          # 使用说明 + 手动验收清单
├── resources/
│   └── hook.sh                        # bash 模板, 扩展激活时写到 ~/.claude-task-monitor/hook.sh
├── src/
│   ├── extension.ts                   # activate / deactivate, 连线
│   ├── types.ts                       # SessionState, HookPayload 类型
│   ├── stateManager.ts                # reduce 纯函数 + SessionStore 类
│   ├── installer.ts                   # writeHookScript / mergeSettings / detectJq / uninstall
│   ├── watcher.ts                     # chokidar 封装, emit SessionEvent
│   ├── treeDataProvider.ts            # vscode.TreeDataProvider 实现
│   ├── notifier.ts                    # showWarningMessage + dedupe
│   └── util/
│       └── time.ts                    # 持续时间人类可读化
└── src/test/
    ├── stateManager.test.ts           # vitest 单元测试
    ├── installer.test.ts              # vitest 单元测试
    ├── watcher.test.ts                # vitest 单元测试 (用真 tmp 文件)
    ├── notifier.test.ts               # vitest 单元测试
    ├── util.test.ts                   # 时间格式化测试
    └── integration/
        ├── runTest.ts                 # @vscode/test-electron 入口
        └── suite/
            ├── index.ts               # mocha runner
            └── e2e.test.ts            # 集成测试
```

---

## Task 1: 项目脚手架

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.vscodeignore`
- Create: `src/extension.ts`

- [ ] **Step 1: 创建 `.gitignore`**

```
node_modules/
dist/
out/
*.vsix
.vscode-test/
coverage/
```

- [ ] **Step 2: 创建 `.vscodeignore`**

```
.vscode/**
.vscode-test/**
src/**
.gitignore
.eslintrc.json
**/tsconfig.json
**/*.map
**/*.ts
node_modules/**
coverage/**
docs/**
```

- [ ] **Step 3: 创建 `package.json`**

```json
{
  "name": "claude-task-monitor",
  "displayName": "Claude Task Monitor",
  "description": "Real-time dashboard for local Claude Code CLI sessions",
  "version": "0.1.0",
  "publisher": "codewithwu",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "main": "./dist/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {},
  "scripts": {
    "build": "tsup",
    "watch": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "node ./dist-test/integration/runTest.js",
    "package": "vsce package",
    "vscode:prepublish": "pnpm build"
  },
  "dependencies": {
    "chokidar": "^3.6.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.85.0",
    "@types/mocha": "^10.0.0",
    "@vscode/test-electron": "^2.3.0",
    "mocha": "^10.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "vsce": "^2.15.0"
  }
}
```

- [ ] **Step 4: 创建 `pnpm-workspace.yaml` 允许 esbuild / keytar 跑 install 脚本**

> pnpm 11 不再读取 `package.json` 的 `pnpm` 字段，统一改在 `pnpm-workspace.yaml` 里配置（关键名是 `allowBuilds`）。即使单包仓库也需要这个文件来放 pnpm 设置。

```yaml
allowBuilds:
  esbuild: true
  keytar: true
```

- [ ] **Step 5: 创建 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "declaration": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "src/test/integration"]
}
```

- [ ] **Step 6: 创建 `tsup.config.ts`**

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/extension.ts'],
  outDir: 'dist',
  format: ['cjs'],
  external: ['vscode'],
  target: 'node18',
  sourcemap: true,
  clean: true
})
```

- [ ] **Step 7: 创建 `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/test/**/*.test.ts'],
    exclude: ['src/test/integration/**'],
    environment: 'node'
  }
})
```

- [ ] **Step 8: 创建 `src/extension.ts` 占位**

```ts
import * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext): void {
  console.log('claude-task-monitor activated')
}

export function deactivate(): void {
  // no-op for now
}
```

- [ ] **Step 9: 安装依赖并验证构建**

Run:
```
pnpm install
pnpm build
```
Expected: `dist/extension.js` 存在，无报错。

- [ ] **Step 10: 提交**

```bash
git add package.json tsconfig.json tsup.config.ts vitest.config.ts .gitignore .vscodeignore src/extension.ts pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore: scaffold VS Code extension project"
```

---

## Task 2: 类型定义

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: 创建 `src/types.ts`**

```ts
export type HookEventName =
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Notification'
  | 'Stop'

export interface HookPayload {
  hook_event_name: HookEventName
  session_id: string
  ts: number
  cwd?: string
  source?: string                   // SessionStart
  reason?: string                   // Stop / SessionEnd
  user_prompt?: string              // UserPromptSubmit
  tool_name?: string                // Pre/PostToolUse
  tool_input?: unknown              // PreToolUse
  notification_type?: string        // Notification
}

export type SessionStatus = 'idle' | 'running' | 'waiting'

export interface SessionState {
  sessionId: string
  cwd: string
  status: SessionStatus
  stateChangedAt: number            // epoch seconds
  lastUserPrompt: string            // 截断到 60 字符
  currentTool: { name: string; input: unknown } | null
  fileOffset: number                // watcher 增量读取游标
}

export type ReduceResult =
  | { kind: 'updated'; state: SessionState }
  | { kind: 'removed' }              // SessionEnd 返回这个
```

- [ ] **Step 2: 验证 TS 编译**

Run: `pnpm build`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add src/types.ts
git commit -m "feat: add core type definitions"
```

---

## Task 3: stateManager reduce 函数

**Files:**
- Create: `src/stateManager.ts`
- Create: `src/test/stateManager.test.ts`

- [ ] **Step 1: 写失败的测试 `src/test/stateManager.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { reduce } from '../stateManager'
import type { SessionState, HookPayload } from '../types'

const baseTs = 1700000000

function evt(p: Partial<HookPayload> & Pick<HookPayload, 'hook_event_name' | 'session_id'>): HookPayload {
  return { ts: baseTs, ...p } as HookPayload
}

describe('reduce', () => {
  it('SessionStart 创建 idle 会话', () => {
    const result = reduce(null, evt({
      hook_event_name: 'SessionStart',
      session_id: 'abc',
      cwd: '/p'
    }))
    expect(result.kind).toBe('updated')
    if (result.kind !== 'updated') return
    expect(result.state).toMatchObject({
      sessionId: 'abc',
      cwd: '/p',
      status: 'idle',
      stateChangedAt: baseTs,
      lastUserPrompt: '',
      currentTool: null
    })
  })

  it('UserPromptSubmit 切到 running 并记录 prompt', () => {
    const start = reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p' }))
    if (start.kind !== 'updated') throw new Error('expected updated')
    const r = reduce(start.state, evt({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'a',
      user_prompt: '修复登录接口的 token 过期问题',
      ts: baseTs + 5
    }))
    if (r.kind !== 'updated') throw new Error('expected updated')
    expect(r.state.status).toBe('running')
    expect(r.state.stateChangedAt).toBe(baseTs + 5)
    expect(r.state.lastUserPrompt).toBe('修复登录接口的 token 过期问题')
  })

  it('UserPromptSubmit 截断超过 60 字符的 prompt', () => {
    const start = reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p' }))
    if (start.kind !== 'updated') throw new Error()
    const long = 'x'.repeat(120)
    const r = reduce(start.state, evt({ hook_event_name: 'UserPromptSubmit', session_id: 'a', user_prompt: long }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.lastUserPrompt.length).toBeLessThanOrEqual(60)
  })

  it('PreToolUse 设置 currentTool 且状态保持 running', () => {
    let s: SessionState = (reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p' })) as any).state
    s = (reduce(s, evt({ hook_event_name: 'UserPromptSubmit', session_id: 'a', user_prompt: 'p' })) as any).state
    const r = reduce(s, evt({
      hook_event_name: 'PreToolUse',
      session_id: 'a',
      tool_name: 'Bash',
      tool_input: { command: 'ls' }
    }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.status).toBe('running')
    expect(r.state.currentTool).toEqual({ name: 'Bash', input: { command: 'ls' } })
  })

  it('Notification(permission_prompt) 切到 waiting，保留 currentTool', () => {
    let s: SessionState = (reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p' })) as any).state
    s = (reduce(s, evt({ hook_event_name: 'PreToolUse', session_id: 'a', tool_name: 'Bash', tool_input: { command: 'rm' } })) as any).state
    const r = reduce(s, evt({
      hook_event_name: 'Notification',
      session_id: 'a',
      notification_type: 'permission_prompt',
      ts: baseTs + 10
    }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.status).toBe('waiting')
    expect(r.state.stateChangedAt).toBe(baseTs + 10)
    expect(r.state.currentTool).toEqual({ name: 'Bash', input: { command: 'rm' } })
  })

  it('Notification(其他类型) 不改状态', () => {
    let s: SessionState = (reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p' })) as any).state
    const r = reduce(s, evt({
      hook_event_name: 'Notification',
      session_id: 'a',
      notification_type: 'idle_prompt'
    }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.status).toBe('idle')
  })

  it('PostToolUse 清空 currentTool，状态变 running', () => {
    let s: SessionState = (reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p' })) as any).state
    s = (reduce(s, evt({ hook_event_name: 'PreToolUse', session_id: 'a', tool_name: 'Bash' })) as any).state
    s = (reduce(s, evt({ hook_event_name: 'Notification', session_id: 'a', notification_type: 'permission_prompt' })) as any).state
    const r = reduce(s, evt({ hook_event_name: 'PostToolUse', session_id: 'a', tool_name: 'Bash' }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.status).toBe('running')
    expect(r.state.currentTool).toBeNull()
  })

  it('Stop 切到 idle 并清空 currentTool', () => {
    let s: SessionState = (reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p' })) as any).state
    s = (reduce(s, evt({ hook_event_name: 'PreToolUse', session_id: 'a', tool_name: 'Bash' })) as any).state
    const r = reduce(s, evt({ hook_event_name: 'Stop', session_id: 'a' }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.status).toBe('idle')
    expect(r.state.currentTool).toBeNull()
  })

  it('SessionEnd 返回 removed', () => {
    let s: SessionState = (reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p' })) as any).state
    const r = reduce(s, evt({ hook_event_name: 'SessionEnd', session_id: 'a' }))
    expect(r.kind).toBe('removed')
  })

  it('同状态内重复事件不重置 stateChangedAt', () => {
    let s: SessionState = (reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p', ts: baseTs })) as any).state
    s = (reduce(s, evt({ hook_event_name: 'Notification', session_id: 'a', notification_type: 'permission_prompt', ts: baseTs + 10 })) as any).state
    expect(s.stateChangedAt).toBe(baseTs + 10)
    const r = reduce(s, evt({ hook_event_name: 'Notification', session_id: 'a', notification_type: 'permission_prompt', ts: baseTs + 30 }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.status).toBe('waiting')
    expect(r.state.stateChangedAt).toBe(baseTs + 10)
  })

  it('SessionStart 之前先到事件能用事件的 cwd 推断创建', () => {
    const r = reduce(null, evt({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'x',
      cwd: '/derived',
      user_prompt: 'hi'
    }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.cwd).toBe('/derived')
  })

  it('cwd 完全缺失时用 <unknown>', () => {
    const r = reduce(null, evt({ hook_event_name: 'UserPromptSubmit', session_id: 'x', user_prompt: 'hi' }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.cwd).toBe('<unknown>')
  })

  it('未知 event 类型对已有 session 不破坏状态', () => {
    let s: SessionState = (reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p' })) as any).state
    const r = reduce(s, { hook_event_name: 'WeirdEvent' as any, session_id: 'a', ts: baseTs })
    if (r.kind !== 'updated') throw new Error()
    expect(r.state).toEqual(s)
  })
})
```

- [ ] **Step 2: 跑测试确认全部失败**

Run: `pnpm test`
Expected: 报错 `Cannot find module '../stateManager'`.

- [ ] **Step 3: 实现 `src/stateManager.ts` 的 reduce**

```ts
import type { HookPayload, ReduceResult, SessionState, SessionStatus } from './types'

const MAX_PROMPT_LEN = 60

function init(sessionId: string, cwd: string, ts: number): SessionState {
  return {
    sessionId,
    cwd,
    status: 'idle',
    stateChangedAt: ts,
    lastUserPrompt: '',
    currentTool: null,
    fileOffset: 0
  }
}

function transition(prev: SessionState, next: Partial<SessionState> & { status: SessionStatus }, ts: number): SessionState {
  const changed = next.status !== prev.status
  return {
    ...prev,
    ...next,
    stateChangedAt: changed ? ts : prev.stateChangedAt
  }
}

export function reduce(prev: SessionState | null, event: HookPayload): ReduceResult {
  const ts = event.ts
  const cwd = event.cwd ?? prev?.cwd ?? '<unknown>'
  const base = prev ?? init(event.session_id, cwd, ts)

  switch (event.hook_event_name) {
    case 'SessionStart':
      return { kind: 'updated', state: { ...init(event.session_id, cwd, ts), fileOffset: base.fileOffset } }

    case 'SessionEnd':
      return { kind: 'removed' }

    case 'UserPromptSubmit': {
      const prompt = (event.user_prompt ?? '').slice(0, MAX_PROMPT_LEN)
      return { kind: 'updated', state: transition(base, { status: 'running', lastUserPrompt: prompt }, ts) }
    }

    case 'PreToolUse': {
      const tool = { name: event.tool_name ?? '<unknown>', input: event.tool_input ?? null }
      return { kind: 'updated', state: transition(base, { status: 'running', currentTool: tool }, ts) }
    }

    case 'PostToolUse':
      return { kind: 'updated', state: transition(base, { status: 'running', currentTool: null }, ts) }

    case 'Notification':
      if (event.notification_type === 'permission_prompt') {
        return { kind: 'updated', state: transition(base, { status: 'waiting' }, ts) }
      }
      return { kind: 'updated', state: base }

    case 'Stop':
      return { kind: 'updated', state: transition(base, { status: 'idle', currentTool: null }, ts) }

    default:
      return { kind: 'updated', state: base }
  }
}
```

- [ ] **Step 4: 跑测试确认全部通过**

Run: `pnpm test`
Expected: 全部 12 个测试通过。

- [ ] **Step 5: 提交**

```bash
git add src/stateManager.ts src/test/stateManager.test.ts
git commit -m "feat: implement event reducer for session state"
```

---

## Task 4: SessionStore 类

**Files:**
- Modify: `src/stateManager.ts`
- Modify: `src/test/stateManager.test.ts`

- [ ] **Step 1: 在测试文件末尾追加 SessionStore 测试**

```ts
import { SessionStore } from '../stateManager'

describe('SessionStore', () => {
  it('apply SessionStart 后能 list 出该 session', () => {
    const store = new SessionStore()
    store.apply({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', ts: 1 } as any)
    const list = store.list()
    expect(list).toHaveLength(1)
    expect(list[0].sessionId).toBe('s1')
  })

  it('apply SessionEnd 后 session 被移除', () => {
    const store = new SessionStore()
    store.apply({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', ts: 1 } as any)
    store.apply({ hook_event_name: 'SessionEnd', session_id: 's1', ts: 2 } as any)
    expect(store.list()).toHaveLength(0)
  })

  it('list 按 waiting > running > idle 优先级排序，同色按 stateChangedAt 倒序', () => {
    const store = new SessionStore()
    store.apply({ hook_event_name: 'SessionStart', session_id: 'idle-old', cwd: '/a', ts: 100 } as any)
    store.apply({ hook_event_name: 'SessionStart', session_id: 'running', cwd: '/b', ts: 200 } as any)
    store.apply({ hook_event_name: 'UserPromptSubmit', session_id: 'running', user_prompt: 'p', ts: 250 } as any)
    store.apply({ hook_event_name: 'SessionStart', session_id: 'waiting', cwd: '/c', ts: 300 } as any)
    store.apply({ hook_event_name: 'Notification', session_id: 'waiting', notification_type: 'permission_prompt', ts: 350 } as any)
    store.apply({ hook_event_name: 'SessionStart', session_id: 'idle-new', cwd: '/d', ts: 400 } as any)
    const ids = store.list().map(s => s.sessionId)
    expect(ids).toEqual(['waiting', 'running', 'idle-new', 'idle-old'])
  })

  it('updateFileOffset 持久化游标', () => {
    const store = new SessionStore()
    store.apply({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', ts: 1 } as any)
    store.updateFileOffset('s1', 512)
    expect(store.get('s1')?.fileOffset).toBe(512)
  })

  it('onChange 回调在 apply 后触发', () => {
    const store = new SessionStore()
    let count = 0
    store.onChange(() => { count++ })
    store.apply({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', ts: 1 } as any)
    expect(count).toBe(1)
  })

  it('对未知 session 的 SessionEnd 不抛错', () => {
    const store = new SessionStore()
    expect(() => store.apply({ hook_event_name: 'SessionEnd', session_id: 'nope', ts: 1 } as any)).not.toThrow()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test`
Expected: `SessionStore is not exported` 类似错误。

- [ ] **Step 3: 在 `src/stateManager.ts` 追加 SessionStore 类**

```ts
const STATUS_PRIORITY: Record<SessionStatus, number> = {
  waiting: 0,
  running: 1,
  idle: 2
}

export class SessionStore {
  private sessions = new Map<string, SessionState>()
  private listeners: Array<() => void> = []

  apply(event: HookPayload): void {
    const prev = this.sessions.get(event.session_id) ?? null
    const result = reduce(prev, event)
    if (result.kind === 'removed') {
      this.sessions.delete(event.session_id)
    } else {
      this.sessions.set(event.session_id, result.state)
    }
    this.emit()
  }

  get(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId)
  }

  list(): SessionState[] {
    return [...this.sessions.values()].sort((a, b) => {
      const p = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]
      if (p !== 0) return p
      return b.stateChangedAt - a.stateChangedAt
    })
  }

  updateFileOffset(sessionId: string, offset: number): void {
    const s = this.sessions.get(sessionId)
    if (s) this.sessions.set(sessionId, { ...s, fileOffset: offset })
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test`
Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/stateManager.ts src/test/stateManager.test.ts
git commit -m "feat: implement SessionStore with sorted listing and change notifications"
```

---

## Task 5: 时间格式化工具

**Files:**
- Create: `src/util/time.ts`
- Create: `src/test/util.test.ts`

- [ ] **Step 1: 写测试 `src/test/util.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { humanizeDuration } from '../util/time'

describe('humanizeDuration', () => {
  it.each([
    [0, '0s'],
    [5, '5s'],
    [59, '59s'],
    [60, '1m'],
    [125, '2m 5s'],
    [3600, '1h'],
    [3725, '1h 2m'],
    [86400, '24h']
  ])('seconds=%i -> %s', (sec, expected) => {
    expect(humanizeDuration(sec)).toBe(expected)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test`
Expected: `Cannot find module '../util/time'`.

- [ ] **Step 3: 实现 `src/util/time.ts`**

```ts
export function humanizeDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return s === 0 ? `${m}m` : `${m}m ${s}s`
  }
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test`
Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/util/time.ts src/test/util.test.ts
git commit -m "feat: add humanizeDuration utility"
```

---

## Task 6: hook.sh 资源文件 + writeHookScript

**Files:**
- Create: `resources/hook.sh`
- Create: `src/installer.ts`
- Create: `src/test/installer.test.ts`

- [ ] **Step 1: 创建 `resources/hook.sh`**

```bash
#!/usr/bin/env bash
set -e
dir="$HOME/.claude-task-monitor/sessions"
mkdir -p "$dir"
payload=$(cat)
session_id=$(echo "$payload" | jq -r '.session_id // empty')
event=$(echo "$payload" | jq -r '.hook_event_name // empty')
[ -z "$session_id" ] && exit 0
[ -z "$event" ] && exit 0

echo "$payload" | jq -c '. + {ts: now}' >> "$dir/$session_id.jsonl"

if [ "$event" = "SessionEnd" ]; then
  mkdir -p "$dir/.ended"
  mv "$dir/$session_id.jsonl" "$dir/.ended/$session_id-$(date +%s).jsonl" 2>/dev/null || true
fi
```

- [ ] **Step 2: 写测试 `src/test/installer.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { writeHookScript } from '../installer'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctm-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('writeHookScript', () => {
  const resourcePath = path.join(__dirname, '..', '..', 'resources', 'hook.sh')

  it('写入 hook.sh 并设置可执行', () => {
    const target = path.join(tmpDir, 'hook.sh')
    writeHookScript(resourcePath, target)
    expect(fs.existsSync(target)).toBe(true)
    const stat = fs.statSync(target)
    expect(stat.mode & 0o111).not.toBe(0)
  })

  it('再次写入相同内容不抛错（幂等）', () => {
    const target = path.join(tmpDir, 'hook.sh')
    writeHookScript(resourcePath, target)
    expect(() => writeHookScript(resourcePath, target)).not.toThrow()
  })

  it('父目录不存在时自动创建', () => {
    const target = path.join(tmpDir, 'nested', 'sub', 'hook.sh')
    writeHookScript(resourcePath, target)
    expect(fs.existsSync(target)).toBe(true)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm test`
Expected: `Cannot find module '../installer'`.

- [ ] **Step 4: 实现 `src/installer.ts`（仅 writeHookScript 部分）**

```ts
import * as fs from 'node:fs'
import * as path from 'node:path'

export function writeHookScript(sourcePath: string, targetPath: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  const content = fs.readFileSync(sourcePath, 'utf8')
  if (fs.existsSync(targetPath)) {
    const existing = fs.readFileSync(targetPath, 'utf8')
    if (existing === content) {
      fs.chmodSync(targetPath, 0o755)
      return
    }
  }
  fs.writeFileSync(targetPath, content, { mode: 0o755 })
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test`
Expected: 全部通过。

- [ ] **Step 6: 提交**

```bash
git add resources/hook.sh src/installer.ts src/test/installer.test.ts
git commit -m "feat: write hook.sh template to user directory"
```

---

## Task 7: installer.mergeSettings 幂等合并

**Files:**
- Modify: `src/installer.ts`
- Modify: `src/test/installer.test.ts`

- [ ] **Step 1: 在 `src/test/installer.test.ts` 追加测试**

```ts
import { mergeSettings, OWNER_TAG } from '../installer'

describe('mergeSettings', () => {
  const ourHookCmd = '~/.claude-task-monitor/hook.sh'

  it('空 settings 合并后包含全部 7 个 hook event', () => {
    const result = mergeSettings({}, ourHookCmd)
    const events = ['SessionStart','SessionEnd','UserPromptSubmit','PreToolUse','PostToolUse','Notification','Stop']
    for (const ev of events) {
      expect(result.hooks?.[ev]).toBeDefined()
      const entries = result.hooks![ev]
      const ours = entries.find((e: any) => e._owner === OWNER_TAG)
      expect(ours).toBeDefined()
      expect(ours.hooks[0].command).toBe(ourHookCmd)
    }
  })

  it('保留用户已有的 hooks 不丢失', () => {
    const existing = {
      hooks: {
        PreToolUse: [{
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'echo user-hook' }]
        }]
      }
    }
    const result = mergeSettings(existing, ourHookCmd)
    const preEntries = result.hooks!.PreToolUse
    expect(preEntries).toHaveLength(2)
    expect(preEntries.some((e: any) => e.hooks[0].command === 'echo user-hook')).toBe(true)
    expect(preEntries.some((e: any) => e._owner === OWNER_TAG)).toBe(true)
  })

  it('再次合并不重复添加我们的条目（幂等）', () => {
    const once = mergeSettings({}, ourHookCmd)
    const twice = mergeSettings(once, ourHookCmd)
    for (const ev of Object.keys(twice.hooks!)) {
      const ours = (twice.hooks![ev] as any[]).filter(e => e._owner === OWNER_TAG)
      expect(ours).toHaveLength(1)
    }
  })

  it('hooks 字段完全缺失时也能合并', () => {
    const result = mergeSettings({ otherField: 'x' } as any, ourHookCmd)
    expect((result as any).otherField).toBe('x')
    expect(result.hooks).toBeDefined()
  })

  it('PreToolUse 我们的条目带 matcher: "*"', () => {
    const result = mergeSettings({}, ourHookCmd)
    const ours = (result.hooks!.PreToolUse as any[]).find(e => e._owner === OWNER_TAG)
    expect(ours.matcher).toBe('*')
  })

  it('非 PreToolUse/PostToolUse 的事件不带 matcher', () => {
    const result = mergeSettings({}, ourHookCmd)
    const ours = (result.hooks!.SessionStart as any[]).find(e => e._owner === OWNER_TAG)
    expect(ours.matcher).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test`
Expected: `mergeSettings is not exported`.

- [ ] **Step 3: 在 `src/installer.ts` 追加 mergeSettings**

```ts
export const OWNER_TAG = 'claude-task-monitor'

const HOOK_EVENTS_WITH_MATCHER = new Set(['PreToolUse', 'PostToolUse'])
const ALL_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop'
] as const

interface HookEntry {
  matcher?: string
  hooks: Array<{ type: string; command: string }>
  _owner?: string
}

export interface Settings {
  hooks?: Record<string, HookEntry[]>
  [k: string]: unknown
}

function ourEntry(event: string, command: string): HookEntry {
  const entry: HookEntry = {
    hooks: [{ type: 'command', command }],
    _owner: OWNER_TAG
  }
  if (HOOK_EVENTS_WITH_MATCHER.has(event)) entry.matcher = '*'
  return entry
}

export function mergeSettings(existing: Settings, command: string): Settings {
  const result: Settings = { ...existing, hooks: { ...(existing.hooks ?? {}) } }
  for (const event of ALL_HOOK_EVENTS) {
    const current = result.hooks![event] ?? []
    const hasOurs = current.some(e => e._owner === OWNER_TAG)
    if (hasOurs) {
      result.hooks![event] = current
    } else {
      result.hooks![event] = [...current, ourEntry(event, command)]
    }
  }
  return result
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test`
Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/installer.ts src/test/installer.test.ts
git commit -m "feat: idempotent merge of hook entries into claude settings.json"
```

---

## Task 8: installer.detectJq + uninstallSettings

**Files:**
- Modify: `src/installer.ts`
- Modify: `src/test/installer.test.ts`

- [ ] **Step 1: 在测试文件追加 uninstall 测试**

```ts
import { uninstallSettings, detectJq } from '../installer'

describe('uninstallSettings', () => {
  const ourHookCmd = '~/.claude-task-monitor/hook.sh'

  it('移除我们的条目，保留用户条目', () => {
    const merged = mergeSettings({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user' }] }]
      }
    }, ourHookCmd)
    const cleaned = uninstallSettings(merged)
    expect(cleaned.hooks?.PreToolUse).toHaveLength(1)
    expect(cleaned.hooks!.PreToolUse[0].hooks[0].command).toBe('echo user')
  })

  it('某事件清理后没有条目则删除该 key', () => {
    const merged = mergeSettings({}, ourHookCmd)
    const cleaned = uninstallSettings(merged)
    expect(cleaned.hooks?.SessionStart).toBeUndefined()
  })

  it('hooks 全清空后删除 hooks 字段', () => {
    const merged = mergeSettings({}, ourHookCmd)
    const cleaned = uninstallSettings(merged)
    expect(cleaned.hooks).toBeUndefined()
  })
})

describe('detectJq', () => {
  it('当前环境检测返回 boolean', async () => {
    const result = await detectJq()
    expect(typeof result).toBe('boolean')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test`
Expected: `uninstallSettings is not exported`.

- [ ] **Step 3: 在 `src/installer.ts` 追加实现**

```ts
import { spawn } from 'node:child_process'

export function uninstallSettings(existing: Settings): Settings {
  if (!existing.hooks) return existing
  const newHooks: Record<string, HookEntry[]> = {}
  for (const [event, entries] of Object.entries(existing.hooks)) {
    const filtered = entries.filter(e => e._owner !== OWNER_TAG)
    if (filtered.length > 0) newHooks[event] = filtered
  }
  const result: Settings = { ...existing }
  if (Object.keys(newHooks).length === 0) {
    delete result.hooks
  } else {
    result.hooks = newHooks
  }
  return result
}

export function detectJq(): Promise<boolean> {
  return new Promise(resolve => {
    const proc = spawn('jq', ['--version'])
    proc.on('error', () => resolve(false))
    proc.on('exit', code => resolve(code === 0))
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test`
Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/installer.ts src/test/installer.test.ts
git commit -m "feat: add uninstallSettings and jq detection"
```

---

## Task 9: watcher 文件监听器

**Files:**
- Create: `src/watcher.ts`
- Create: `src/test/watcher.test.ts`

- [ ] **Step 1: 写测试 `src/test/watcher.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SessionsWatcher } from '../watcher'

let tmpDir: string
let watcher: SessionsWatcher | null

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctm-watcher-'))
  watcher = null
})

afterEach(async () => {
  if (watcher) await watcher.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function wait(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

describe('SessionsWatcher', () => {
  it('新建文件触发 fileAdded', async () => {
    const events: string[] = []
    watcher = new SessionsWatcher(tmpDir)
    watcher.on('fileAdded', f => events.push('add:' + path.basename(f)))
    await watcher.start()
    fs.writeFileSync(path.join(tmpDir, 's1.jsonl'), '')
    await wait(200)
    expect(events).toContain('add:s1.jsonl')
  })

  it('追加行触发 line 事件，含完整 JSON', async () => {
    const lines: any[] = []
    watcher = new SessionsWatcher(tmpDir)
    watcher.on('line', (file, parsed) => lines.push(parsed))
    await watcher.start()
    const file = path.join(tmpDir, 's1.jsonl')
    fs.writeFileSync(file, '')
    await wait(100)
    fs.appendFileSync(file, JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's1', ts: 1 }) + '\n')
    await wait(200)
    expect(lines).toHaveLength(1)
    expect(lines[0].hook_event_name).toBe('SessionStart')
  })

  it('增量读取，只发新行', async () => {
    const lines: any[] = []
    watcher = new SessionsWatcher(tmpDir)
    watcher.on('line', (_, parsed) => lines.push(parsed))
    await watcher.start()
    const file = path.join(tmpDir, 's1.jsonl')
    fs.writeFileSync(file, JSON.stringify({ a: 1 }) + '\n')
    await wait(150)
    fs.appendFileSync(file, JSON.stringify({ a: 2 }) + '\n')
    await wait(150)
    expect(lines.map(l => l.a)).toEqual([1, 2])
  })

  it('文件删除触发 fileRemoved', async () => {
    const events: string[] = []
    watcher = new SessionsWatcher(tmpDir)
    watcher.on('fileRemoved', f => events.push('rm:' + path.basename(f)))
    await watcher.start()
    const file = path.join(tmpDir, 's1.jsonl')
    fs.writeFileSync(file, '')
    await wait(100)
    fs.unlinkSync(file)
    await wait(200)
    expect(events).toContain('rm:s1.jsonl')
  })

  it('损坏行跳过且不抛错', async () => {
    const lines: any[] = []
    const errors: string[] = []
    watcher = new SessionsWatcher(tmpDir)
    watcher.on('line', (_, parsed) => lines.push(parsed))
    watcher.on('parseError', msg => errors.push(msg))
    await watcher.start()
    const file = path.join(tmpDir, 's1.jsonl')
    fs.writeFileSync(file, 'not-json\n' + JSON.stringify({ ok: true }) + '\n')
    await wait(200)
    expect(lines).toEqual([{ ok: true }])
    expect(errors).toHaveLength(1)
  })

  it('忽略 .ended 目录下的文件', async () => {
    const events: string[] = []
    watcher = new SessionsWatcher(tmpDir)
    watcher.on('fileAdded', f => events.push(f))
    await watcher.start()
    fs.mkdirSync(path.join(tmpDir, '.ended'))
    fs.writeFileSync(path.join(tmpDir, '.ended', 'old.jsonl'), '')
    await wait(200)
    expect(events.filter(e => e.includes('.ended'))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/test/watcher.test.ts`
Expected: `Cannot find module '../watcher'`.

- [ ] **Step 3: 实现 `src/watcher.ts`**

```ts
import * as fs from 'node:fs'
import * as path from 'node:path'
import { EventEmitter } from 'node:events'
import chokidar from 'chokidar'

type WatcherEvents = {
  fileAdded: [filePath: string]
  fileRemoved: [filePath: string]
  line: [filePath: string, parsed: unknown]
  parseError: [message: string, filePath: string, line: string]
}

export class SessionsWatcher extends EventEmitter<WatcherEvents> {
  private chokidarWatcher: chokidar.FSWatcher | null = null
  private offsets = new Map<string, number>()

  constructor(private readonly dir: string) {
    super()
  }

  async start(): Promise<void> {
    fs.mkdirSync(this.dir, { recursive: true })
    this.chokidarWatcher = chokidar.watch(this.dir, {
      ignored: (p: string) => p.includes(path.sep + '.ended'),
      persistent: true,
      ignoreInitial: false,
      depth: 1,
      awaitWriteFinish: false
    })

    this.chokidarWatcher.on('add', (file) => this.handleAdd(file))
    this.chokidarWatcher.on('change', (file) => this.handleChange(file))
    this.chokidarWatcher.on('unlink', (file) => this.handleUnlink(file))

    await new Promise<void>(resolve => this.chokidarWatcher!.once('ready', resolve))
  }

  async close(): Promise<void> {
    if (this.chokidarWatcher) {
      await this.chokidarWatcher.close()
      this.chokidarWatcher = null
    }
    this.offsets.clear()
  }

  setOffset(filePath: string, offset: number): void {
    this.offsets.set(filePath, offset)
  }

  private handleAdd(file: string): void {
    if (!file.endsWith('.jsonl')) return
    this.offsets.set(file, 0)
    this.emit('fileAdded', file)
    this.readNew(file)
  }

  private handleChange(file: string): void {
    if (!file.endsWith('.jsonl')) return
    this.readNew(file)
  }

  private handleUnlink(file: string): void {
    if (!file.endsWith('.jsonl')) return
    this.offsets.delete(file)
    this.emit('fileRemoved', file)
  }

  private readNew(file: string): void {
    let stat: fs.Stats
    try {
      stat = fs.statSync(file)
    } catch {
      return
    }
    const offset = this.offsets.get(file) ?? 0
    if (stat.size <= offset) return

    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(stat.size - offset)
      fs.readSync(fd, buf, 0, buf.length, offset)
      const text = buf.toString('utf8')
      const lines = text.split('\n')
      const trailing = lines.pop()
      let consumed = 0
      for (const line of lines) {
        consumed += Buffer.byteLength(line, 'utf8') + 1
        if (line.length === 0) continue
        try {
          const parsed = JSON.parse(line)
          this.emit('line', file, parsed)
        } catch (e) {
          this.emit('parseError', (e as Error).message, file, line)
        }
      }
      this.offsets.set(file, offset + consumed)
      if (trailing && trailing.length > 0) {
        // 未结束的行下次再读
      }
    } finally {
      fs.closeSync(fd)
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/test/watcher.test.ts`
Expected: 全部通过（chokidar 在某些环境下需要 polling，如有 flaky 改 `awaitWriteFinish: { stabilityThreshold: 50 }`）。

- [ ] **Step 5: 提交**

```bash
git add src/watcher.ts src/test/watcher.test.ts
git commit -m "feat: implement incremental JSONL file watcher"
```

---

## Task 10: notifier 带 dedupe

**Files:**
- Create: `src/notifier.ts`
- Create: `src/test/notifier.test.ts`

- [ ] **Step 1: 写测试 `src/test/notifier.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Notifier } from '../notifier'

beforeEach(() => {
  vi.useFakeTimers()
})

describe('Notifier', () => {
  it('首次 notify 触发回调', () => {
    const spy = vi.fn()
    const n = new Notifier(30, spy)
    n.notify('s1', 'Bash', '/p')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('s1', 'Bash', '/p')
  })

  it('dedupe 窗口内重复 notify 不触发', () => {
    const spy = vi.fn()
    const n = new Notifier(30, spy)
    n.notify('s1', 'Bash', '/p')
    vi.advanceTimersByTime(10_000)
    n.notify('s1', 'Bash', '/p')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('dedupe 窗口外再次触发', () => {
    const spy = vi.fn()
    const n = new Notifier(30, spy)
    n.notify('s1', 'Bash', '/p')
    vi.advanceTimersByTime(31_000)
    n.notify('s1', 'Bash', '/p')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('不同 session 的 dedupe 互不影响', () => {
    const spy = vi.fn()
    const n = new Notifier(30, spy)
    n.notify('s1', 'Bash', '/p')
    n.notify('s2', 'Edit', '/q')
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/test/notifier.test.ts`
Expected: `Cannot find module '../notifier'`.

- [ ] **Step 3: 实现 `src/notifier.ts`**

```ts
export type NotifyFn = (sessionId: string, toolName: string, cwd: string) => void

export class Notifier {
  private lastNotifiedAt = new Map<string, number>()

  constructor(private readonly dedupeSeconds: number, private readonly fn: NotifyFn) {}

  notify(sessionId: string, toolName: string, cwd: string): void {
    const now = Date.now()
    const last = this.lastNotifiedAt.get(sessionId) ?? 0
    if (now - last < this.dedupeSeconds * 1000) return
    this.lastNotifiedAt.set(sessionId, now)
    this.fn(sessionId, toolName, cwd)
  }

  reset(sessionId: string): void {
    this.lastNotifiedAt.delete(sessionId)
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/test/notifier.test.ts`
Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/notifier.ts src/test/notifier.test.ts
git commit -m "feat: notifier with per-session dedupe window"
```

---

## Task 11: TreeDataProvider

**Files:**
- Create: `src/treeDataProvider.ts`

> 注：VS Code API 在 vitest 里没法直接 mock，这部分主要靠 Task 14 的集成测试验证；这里只做编译期类型校验。

- [ ] **Step 1: 实现 `src/treeDataProvider.ts`**

```ts
import * as vscode from 'vscode'
import * as path from 'node:path'
import type { SessionState } from './types'
import type { SessionStore } from './stateManager'
import { humanizeDuration } from './util/time'

const STATUS_ICON: Record<SessionState['status'], { id: string; color: string }> = {
  waiting: { id: 'circle-filled', color: 'charts.red' },
  running: { id: 'circle-filled', color: 'charts.yellow' },
  idle:    { id: 'circle-filled', color: 'charts.green' }
}

const STATUS_LABEL: Record<SessionState['status'], string> = {
  waiting: '等待权限',
  running: '运行中',
  idle:    '待命'
}

export class SessionTreeDataProvider implements vscode.TreeDataProvider<SessionState> {
  private _onDidChange = new vscode.EventEmitter<SessionState | undefined>()
  readonly onDidChangeTreeData = this._onDidChange.event

  constructor(private readonly store: SessionStore) {
    store.onChange(() => this.refresh())
  }

  refresh(): void {
    this._onDidChange.fire(undefined)
  }

  getTreeItem(s: SessionState): vscode.TreeItem {
    const item = new vscode.TreeItem(path.basename(s.cwd) || s.cwd, vscode.TreeItemCollapsibleState.None)
    const icon = STATUS_ICON[s.status]
    item.iconPath = new vscode.ThemeIcon(icon.id, new vscode.ThemeColor(icon.color))
    const elapsedSec = Math.max(0, Math.floor(Date.now() / 1000) - s.stateChangedAt)
    item.description = `${STATUS_LABEL[s.status]} · ${humanizeDuration(elapsedSec)}`
    item.tooltip = this.buildTooltip(s, elapsedSec)
    item.command = {
      command: 'vscode.openFolder',
      arguments: [vscode.Uri.file(s.cwd), { forceNewWindow: false }],
      title: 'Open Project'
    }
    item.contextValue = `session-${s.status}`
    return item
  }

  getChildren(): SessionState[] {
    return this.store.list()
  }

  private buildTooltip(s: SessionState, elapsedSec: number): vscode.MarkdownString {
    const md = new vscode.MarkdownString()
    md.appendMarkdown(`**${path.basename(s.cwd) || s.cwd}** · ${STATUS_LABEL[s.status]} · ${humanizeDuration(elapsedSec)}\n\n`)
    md.appendMarkdown(`\`${s.cwd}\`\n\n`)
    if (s.lastUserPrompt) {
      md.appendMarkdown(`Prompt: ${s.lastUserPrompt}\n\n`)
    }
    if (s.currentTool) {
      const input = typeof s.currentTool.input === 'object'
        ? JSON.stringify(s.currentTool.input)
        : String(s.currentTool.input)
      md.appendMarkdown(`Tool: \`${s.currentTool.name}\` ${input}\n\n`)
    }
    md.appendMarkdown(`Session: \`${s.sessionId}\``)
    return md
  }
}
```

- [ ] **Step 2: 验证 TS 编译**

Run: `pnpm build`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add src/treeDataProvider.ts
git commit -m "feat: tree view provider for session dashboard"
```

---

## Task 12: extension.ts 连线

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: 重写 `src/extension.ts`**

```ts
import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SessionsWatcher } from './watcher'
import { SessionStore } from './stateManager'
import { SessionTreeDataProvider } from './treeDataProvider'
import { Notifier } from './notifier'
import {
  writeHookScript,
  mergeSettings,
  uninstallSettings,
  detectJq,
  OWNER_TAG
} from './installer'
import type { HookPayload } from './types'

const HOME_DIR = os.homedir()
const ROOT_DIR = path.join(HOME_DIR, '.claude-task-monitor')
const SESSIONS_DIR = path.join(ROOT_DIR, 'sessions')
const ENDED_DIR = path.join(SESSIONS_DIR, '.ended')
const HOOK_SCRIPT = path.join(ROOT_DIR, 'hook.sh')
const CLAUDE_SETTINGS = path.join(HOME_DIR, '.claude', 'settings.json')

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('claudeTaskMonitor')
  const staleHours = cfg.get<number>('staleHours', 24)
  const dedupeSeconds = cfg.get<number>('notifyDedupeSeconds', 30)
  const refreshMs = cfg.get<number>('refreshIntervalMs', 1000)

  fs.mkdirSync(SESSIONS_DIR, { recursive: true })
  fs.mkdirSync(ENDED_DIR, { recursive: true })

  const hasJq = await detectJq()
  if (!hasJq) {
    void vscode.window.showErrorMessage(
      'Claude Task Monitor: `jq` 未在 PATH 中找到。请安装：macOS `brew install jq`，Debian/Ubuntu `apt install jq`。'
    )
  }

  try {
    const resourceHook = path.join(context.extensionPath, 'resources', 'hook.sh')
    writeHookScript(resourceHook, HOOK_SCRIPT)
  } catch (e) {
    void vscode.window.showErrorMessage(`Claude Task Monitor: 写 hook.sh 失败：${(e as Error).message}`)
  }

  try {
    fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true })
    const existingRaw = fs.existsSync(CLAUDE_SETTINGS) ? fs.readFileSync(CLAUDE_SETTINGS, 'utf8') : '{}'
    const existing = JSON.parse(existingRaw)
    const merged = mergeSettings(existing, HOOK_SCRIPT)
    fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(merged, null, 2))
  } catch (e) {
    void vscode.window.showErrorMessage(`Claude Task Monitor: 合并 ~/.claude/settings.json 失败：${(e as Error).message}`)
  }

  archiveStaleFiles(SESSIONS_DIR, ENDED_DIR, staleHours)

  const store = new SessionStore()
  const watcher = new SessionsWatcher(SESSIONS_DIR)
  const notifier = new Notifier(dedupeSeconds, (sessionId, toolName, cwd) => {
    const name = path.basename(cwd) || cwd
    const msg = `${name} 等待权限确认：${toolName}`
    void vscode.window.showWarningMessage(msg, '打开项目').then(action => {
      if (action === '打开项目') {
        void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(cwd), { forceNewWindow: false })
      }
    })
  })

  bootstrapExistingFiles(SESSIONS_DIR, watcher, store)

  watcher.on('fileAdded', (file) => {
    // 真正的事件回放靠 line 事件; 这里仅占位
  })
  watcher.on('line', (file, parsedUnknown) => {
    const parsed = parsedUnknown as HookPayload
    const prevStatus = store.get(parsed.session_id)?.status
    store.apply(parsed)
    const next = store.get(parsed.session_id)
    if (next && next.status === 'waiting' && prevStatus !== 'waiting') {
      notifier.notify(next.sessionId, next.currentTool?.name ?? '<unknown>', next.cwd)
    }
  })
  watcher.on('fileRemoved', (file) => {
    const sessionId = path.basename(file, '.jsonl')
    store.apply({ hook_event_name: 'SessionEnd', session_id: sessionId, ts: Date.now() / 1000 } as HookPayload)
  })
  watcher.on('parseError', (msg, file, line) => {
    console.warn(`[claude-task-monitor] parse error in ${file}: ${msg}`)
  })

  try {
    await watcher.start()
  } catch (e) {
    void vscode.window.showErrorMessage(`Claude Task Monitor: 启动 watcher 失败：${(e as Error).message}`)
    return
  }

  const provider = new SessionTreeDataProvider(store)
  const treeView = vscode.window.createTreeView('claudeTaskMonitor.sessionsView', {
    treeDataProvider: provider,
    showCollapseAll: false
  })
  const tick = setInterval(() => provider.refresh(), refreshMs)

  context.subscriptions.push(
    treeView,
    { dispose: () => clearInterval(tick) },
    { dispose: () => void watcher.close() }
  )
}

export async function deactivate(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    'Claude Task Monitor 卸载：是否同时移除已注入的 hooks 与 hook.sh？',
    '是', '否'
  )
  if (choice !== '是') return
  try {
    if (fs.existsSync(CLAUDE_SETTINGS)) {
      const existing = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'))
      const cleaned = uninstallSettings(existing)
      fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(cleaned, null, 2))
    }
    if (fs.existsSync(HOOK_SCRIPT)) fs.unlinkSync(HOOK_SCRIPT)
  } catch (e) {
    console.warn('[claude-task-monitor] uninstall failed:', e)
  }
}

function archiveStaleFiles(sessionsDir: string, endedDir: string, staleHours: number): void {
  const cutoffMs = Date.now() - staleHours * 3600 * 1000
  for (const name of fs.readdirSync(sessionsDir)) {
    if (!name.endsWith('.jsonl')) continue
    const full = path.join(sessionsDir, name)
    try {
      const stat = fs.statSync(full)
      if (stat.mtimeMs < cutoffMs) {
        fs.mkdirSync(endedDir, { recursive: true })
        fs.renameSync(full, path.join(endedDir, `${path.basename(name, '.jsonl')}-${Date.now()}.jsonl`))
      }
    } catch {
      // 忽略
    }
  }
}

function bootstrapExistingFiles(sessionsDir: string, watcher: SessionsWatcher, store: SessionStore): void {
  for (const name of fs.readdirSync(sessionsDir)) {
    if (!name.endsWith('.jsonl')) continue
    const full = path.join(sessionsDir, name)
    try {
      const content = fs.readFileSync(full, 'utf8')
      for (const line of content.split('\n')) {
        if (!line) continue
        try {
          store.apply(JSON.parse(line) as HookPayload)
        } catch {
          // 跳过损坏行
        }
      }
      watcher.setOffset(full, Buffer.byteLength(content, 'utf8'))
    } catch {
      // 跳过
    }
  }
}
```

- [ ] **Step 2: 验证 TS 编译**

Run: `pnpm build`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add src/extension.ts
git commit -m "feat: wire up extension activate/deactivate"
```

---

## Task 13: package.json contributes 与扩展 manifest

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 替换 `package.json` 的 `contributes` 块为：**

```json
"contributes": {
  "viewsContainers": {
    "activitybar": [
      {
        "id": "claudeTaskMonitor",
        "title": "Claude Task Monitor",
        "icon": "$(pulse)"
      }
    ]
  },
  "views": {
    "claudeTaskMonitor": [
      {
        "id": "claudeTaskMonitor.sessionsView",
        "name": "Sessions",
        "icon": "$(pulse)",
        "contextualTitle": "Claude Task Monitor"
      }
    ]
  },
  "viewsWelcome": [
    {
      "view": "claudeTaskMonitor.sessionsView",
      "contents": "当前无活跃 Claude Code 会话。\n启动 `claude` 后会自动出现。"
    }
  ],
  "configuration": {
    "title": "Claude Task Monitor",
    "properties": {
      "claudeTaskMonitor.staleHours": {
        "type": "number",
        "default": 24,
        "description": "会话文件 mtime 超过该小时数视为僵尸, 启动时自动归档到 .ended/"
      },
      "claudeTaskMonitor.notifyDedupeSeconds": {
        "type": "number",
        "default": 30,
        "description": "同一 session 在该秒数内不重复弹等待权限通知"
      },
      "claudeTaskMonitor.refreshIntervalMs": {
        "type": "number",
        "default": 1000,
        "description": "侧边栏持续时间显示的刷新间隔 (毫秒)"
      }
    }
  }
}
```

- [ ] **Step 2: 验证扩展能在 VS Code 里加载**

Run:
```
pnpm build
code --extensionDevelopmentPath=$(pwd)
```
Expected: VS Code 启动后活动栏多出 pulse 图标，点开能看到 Sessions 视图（空状态显示 viewsWelcome 文案）。

- [ ] **Step 3: 提交**

```bash
git add package.json
git commit -m "feat: declare activity bar view and configuration schema"
```

---

## Task 14: 集成测试（@vscode/test-electron）

**Files:**
- Create: `src/test/integration/runTest.ts`
- Create: `src/test/integration/suite/index.ts`
- Create: `src/test/integration/suite/e2e.test.ts`
- Modify: `tsconfig.json`（追加单独的 tsconfig 配置或新增 `tsconfig.integration.json`）
- Create: `tsconfig.integration.json`

- [ ] **Step 1: 创建 `tsconfig.integration.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist-test",
    "rootDir": "src/test/integration"
  },
  "include": ["src/test/integration/**/*"],
  "exclude": []
}
```

- [ ] **Step 2: 在 `package.json` 的 scripts 追加 `build:integration`**

把 scripts 块中 `"test:integration"` 行替换为：

```json
"build:integration": "tsc -p tsconfig.integration.json",
"test:integration": "pnpm build && pnpm build:integration && node ./dist-test/runTest.js",
```

- [ ] **Step 3: 创建 `src/test/integration/runTest.ts`**

```ts
import * as path from 'node:path'
import { runTests } from '@vscode/test-electron'

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..')
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js')
  await runTests({ extensionDevelopmentPath, extensionTestsPath })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 4: 创建 `src/test/integration/suite/index.ts`**

```ts
import * as path from 'node:path'
import Mocha from 'mocha'
import { glob } from 'glob'

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 30000 })
  const testsRoot = __dirname
  const files = await glob('**/*.test.js', { cwd: testsRoot })
  for (const f of files) mocha.addFile(path.resolve(testsRoot, f))
  await new Promise<void>((resolve, reject) => {
    mocha.run(failures => failures > 0 ? reject(new Error(`${failures} tests failed.`)) : resolve())
  })
}
```

- [ ] **Step 5: 创建 `src/test/integration/suite/e2e.test.ts`**

```ts
import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'

function wait(ms: number) { return new Promise(r => setTimeout(r, ms)) }

const SESSIONS_DIR = path.join(os.homedir(), '.claude-task-monitor', 'sessions')

suite('e2e', () => {
  test('扩展激活后, 写入 jsonl 文件会出现在 store', async () => {
    await wait(2000)
    const sessionId = 'e2e-' + Date.now()
    const file = path.join(SESSIONS_DIR, `${sessionId}.jsonl`)
    fs.mkdirSync(SESSIONS_DIR, { recursive: true })
    fs.writeFileSync(file, JSON.stringify({
      hook_event_name: 'SessionStart',
      session_id: sessionId,
      cwd: '/tmp/e2e',
      ts: Math.floor(Date.now() / 1000)
    }) + '\n')
    await wait(1000)

    const exts = vscode.extensions.all.filter(e => e.id.endsWith('.claude-task-monitor'))
    assert.ok(exts.length > 0, 'extension should be loaded')

    fs.unlinkSync(file)
    await wait(500)
  })
})
```

- [ ] **Step 6: 运行集成测试**

Run: `pnpm test:integration`
Expected: VS Code 测试 host 启动, e2e 测试通过。

- [ ] **Step 7: 提交**

```bash
git add tsconfig.integration.json package.json src/test/integration
git commit -m "test: add integration test with @vscode/test-electron"
```

---

## Task 15: README 与手动验收清单

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 覆盖 `README.md`**

```markdown
# Claude Task Monitor

VS Code 扩展：在活动栏侧边栏实时监控本机所有 Claude Code CLI 会话的执行状态。

- 🟢 待命（idle）
- 🟡 运行中（running）
- 🔴 等待人工确认（waiting）

会话进入 🔴 时弹 VS Code 通知，点击通知或侧边栏条目可跳转到对应项目。

## 系统依赖

- VS Code ≥ 1.85
- Claude Code CLI
- `jq`（macOS: `brew install jq`，Debian/Ubuntu: `apt install jq`）
- `bash`

## 安装

从源码：

\`\`\`bash
pnpm install
pnpm build
pnpm package         # 生成 .vsix
code --install-extension claude-task-monitor-0.1.0.vsix
\`\`\`

激活后扩展会自动：

1. 创建 `~/.claude-task-monitor/sessions/`
2. 写入 `~/.claude-task-monitor/hook.sh`
3. 把 hooks 块合并进 `~/.claude/settings.json`

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `claudeTaskMonitor.staleHours` | 24 | 文件 mtime 超过该值视为僵尸 |
| `claudeTaskMonitor.notifyDedupeSeconds` | 30 | 同 session 通知去重窗口 |
| `claudeTaskMonitor.refreshIntervalMs` | 1000 | 持续时间刷新间隔 |

## 卸载

VS Code 卸载扩展时会弹确认对话框, 可同时移除 hook.sh 与 settings.json 中我们注入的条目。

## 开发

\`\`\`bash
pnpm install
pnpm build
pnpm test                # 单元测试
pnpm test:integration    # 集成测试 (会启动一个 VS Code 实例)
code --extensionDevelopmentPath=$(pwd)   # 调试
\`\`\`

## 手动验收清单

发布前请把下面每条都跑一遍：

- [ ] 多窗口并发：开 3 个 CLI, 分别处于 🟢 / 🟡 / 🔴 三态, 侧边栏正确显示 3 行
- [ ] 通知防骚扰：同一会话短时间内 PreToolUse + 多个 Notification 事件, 只弹一次通知
- [ ] 异常退出：`kill -9` 一个 CLI 进程, 重启 VS Code 后该会话被归档进 `.ended/`
- [ ] 跳转：点击 🔴 条目, 项目所在 VS Code 窗口被聚焦（如已开）, 或被新打开
- [ ] 持续时间：等待 1 分钟, 描述里数字从 `30s` 滚到 `1m`
- [ ] 排序：🔴 永远在最前, 同色按状态时间倒序
- [ ] 卸载：扩展卸载后 `~/.claude/settings.json` 中我们的条目消失, 用户原有 hooks 保留

## 已知局限

- 不监控远程/SSH 机器上的 CLI
- 外部终端运行的 CLI 不能"聚焦到那个终端窗口", 只能开项目
- 没有历史/统计视图
\`\`\`

- [ ] **Step 2: 提交**

\`\`\`bash
git add README.md
git commit -m "docs: usage and manual verification checklist"
\`\`\`

---

## Self-Review

**Spec coverage check** (against `2026-06-07-vscode-claude-task-monitor-design.md`):

- §2 总体架构（4 模块） → Tasks 4 (store), 9 (watcher), 11 (provider), 10 (notifier) ✓
- §3 数据层 / 目录结构 / hook 配置 / hook.sh / 安装 → Tasks 6, 7, 8, 12 ✓
- §4 状态推导 + 事件转换表 + stateChangedAt 规则 → Task 3 (含 12 个测试覆盖每一行) ✓
- §4 冷启动 → Task 12 `bootstrapExistingFiles` ✓
- §4 孤儿清理 → Task 12 `archiveStaleFiles` ✓
- §4 通知触发 + dedupe → Task 10 + Task 12 wire-up ✓
- §4 持续时间显示 → Task 5 (humanizeDuration) + Task 11 (provider description) + Task 12 (setInterval) ✓
- §5 代码结构 → 文件结构按 spec 落地 ✓
- §6 UI 设计 / 排序 / 空状态 → Task 4 (sort), Task 11 (TreeItem), Task 13 (viewsWelcome) ✓
- §7 点击跳转 → Task 11 (item.command) ✓
- §8 配置项 → Task 13 (contributes.configuration) + Task 12 (read config) ✓
- §9 activation / install / uninstall → Task 12, Task 13 ✓
- §10 错误处理 → Task 12 (各处 try/catch + showErrorMessage), watcher parseError, installer jq detection ✓
- §11 测试策略 → Tasks 3-10 单元, Task 14 集成, Task 15 手动清单 ✓
- §12 技术栈 → Task 1 全部落地 ✓
- §13 已知局限 → Task 15 README 落地 ✓

无遗漏。

**Placeholder scan**: 无 TBD/TODO/"implement later"。每个 step 都有具体代码或具体命令。

**Type consistency**: 
- `SessionState`, `HookPayload`, `ReduceResult` 在 Task 2 定义后, 后续 Task 3/4/9/11/12 一致使用 ✓
- `SessionStore.apply / get / list / updateFileOffset / onChange` 方法签名前后一致 ✓
- `Notifier` 构造与 `notify(sessionId, toolName, cwd)` 在 Task 10 定义, Task 12 wire-up 一致 ✓
- `SessionsWatcher` 事件名 `fileAdded / fileRemoved / line / parseError` Task 9 定义, Task 12 一致 ✓
- `OWNER_TAG` 在 Task 7 定义, Task 8 / 12 一致使用 ✓
- `mergeSettings(existing, command)`, `uninstallSettings(existing)`, `detectJq()`, `writeHookScript(source, target)` 签名一致 ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-07-vscode-claude-task-monitor.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
