import { describe, it, expect, vi } from 'vitest'
import { renderRowPresentation, DEFAULT_LONG_WAITING_THRESHOLD_SEC } from '../util/rowPresentation.js'
import type { SessionState } from '../types.js'

// status label 文案走 i18n,显式 mock 为 zh-cn 跟现有断言对齐。
vi.mock('vscode', () => ({ env: { language: 'zh-cn' } }))

function makeSession(overrides: Partial<SessionState> & { status: SessionState['status'] }): SessionState {
  return {
    sessionId: 'sess-1',
    cwd: '/home/me/projects/my-app',
    stateChangedAt: 0,
    lastUserPrompt: '',
    currentTool: null,
    fileOffset: 0,
    ...overrides
  }
}

describe('renderRowPresentation', () => {
  // elapsedSec 由 caller 注入,函数不再读 Date.now()
  // (stateChangedAt 留 0 不影响 —— 函数不读它,只看 elapsedSec 参数)

  it('waiting 行 + Bash 短命令:label 拼 toolSummary,description 拼 tool_name + duration', () => {
    const s = makeSession({
      status: 'waiting',
      currentTool: { name: 'Bash', input: { command: 'rm -rf node_modules' } }
    })
    const row = renderRowPresentation(s, 42)
    expect(row.label).toBe('rm -rf node_modules · my-app')
    expect(row.description).toBe('等待权限 · Bash · 42s')
    expect(row.iconId).toBe('circle-filled')
    expect(row.iconColor).toBe('charts.red')
  })

  it('waiting 行 + Edit:label 取 file_path basename', () => {
    const s = makeSession({
      status: 'waiting',
      currentTool: { name: 'Edit', input: { file_path: '/srv/proj/auth.ts' } }
    })
    const row = renderRowPresentation(s, 12)
    expect(row.label).toBe('auth.ts · my-app')
    expect(row.description).toBe('等待权限 · Edit · 12s')
  })

  it('waiting 持续 ≥ 5min:icon 升级为 alert + errorForeground', () => {
    const s = makeSession({
      status: 'waiting',
      currentTool: { name: 'Bash', input: { command: 'git push --force' } }
    })
    const row = renderRowPresentation(s, DEFAULT_LONG_WAITING_THRESHOLD_SEC)  // 恰好 5min
    expect(row.iconId).toBe('alert')
    expect(row.iconColor).toBe('errorForeground')
  })

  it('waiting 4m59s 仍用普通圆点(不到阈值)', () => {
    const s = makeSession({
      status: 'waiting',
      currentTool: { name: 'Bash', input: { command: 'ls' } }
    })
    const row = renderRowPresentation(s, DEFAULT_LONG_WAITING_THRESHOLD_SEC - 1)
    expect(row.iconId).toBe('circle-filled')
    expect(row.iconColor).toBe('charts.red')
  })

  it('running 行:不展示 tool_name,label 仅 projectName;icon 是 sync~spin (旋转动画)', () => {
    const s = makeSession({
      status: 'running',
      currentTool: { name: 'Bash', input: { command: 'ls' } }  // running 也会有 currentTool,但不暴露
    })
    const row = renderRowPresentation(s, 3)
    expect(row.label).toBe('my-app')
    expect(row.description).toBe('运行中 · 3s')
    expect(row.iconId).toBe('sync~spin')        // 形状 + 动画 双编码区别于 waiting/idle
    expect(row.iconColor).toBe('charts.yellow')
  })

  it('idle 行:icon 是 circle-outline (区别于 waiting/running 的填充形态)', () => {
    const s = makeSession({
      status: 'idle',
      currentTool: null
    })
    const row = renderRowPresentation(s, 60)
    expect(row.label).toBe('my-app')
    expect(row.description).toBe('待命 · 1m')
    expect(row.iconId).toBe('circle-outline')
    expect(row.iconColor).toBe('charts.green')
  })

  it('waiting 但 currentTool 为 null:label 仅 projectName,description 不拼 tool_name', () => {
    const s = makeSession({
      status: 'waiting',
      currentTool: null
    })
    const row = renderRowPresentation(s, 5)
    expect(row.label).toBe('my-app')
    expect(row.description).toBe('等待权限 · 5s')
  })

  it('cwd 是根路径时 fallback 到 cwd 字符串', () => {
    const s = makeSession({
      status: 'idle',
      cwd: '/'
    })
    const row = renderRowPresentation(s, 1)
    expect(row.label).toBe('/')
  })

  it('elapsedSec 不会小于 0(负值时夹到 0)', () => {
    const s = makeSession({ status: 'running' })
    // caller 算 elapsed 时遇到 stateChangedAt 在未来会得到负值,
    // 函数负责 max(0, ...) —— 这是函数唯一处理 elapsed 的地方
    const row = renderRowPresentation(s, -100)
    expect(row.description).toBe('运行中 · 0s')
  })

  it('自定义 longWaitThreshold:用更小的阈值 (60s) 时,wating 61s 就升级为 alert', () => {
    const s = makeSession({
      status: 'waiting',
      currentTool: { name: 'Bash', input: { command: 'ls' } }
    })
    const row = renderRowPresentation(s, 61, 60)
    expect(row.iconId).toBe('alert')
    expect(row.iconColor).toBe('errorForeground')
  })

  it('自定义 longWaitThreshold:同 elapsed 但默认阈值 (300s) 下仍是 circle-filled', () => {
    const s = makeSession({
      status: 'waiting',
      currentTool: { name: 'Bash', input: { command: 'ls' } }
    })
    const row = renderRowPresentation(s, 61, 300)
    expect(row.iconId).toBe('circle-filled')
  })

  it('dyingAt 有值:icon 改 circle-slash + descriptionForeground,description 加 "已退出" 前缀', () => {
    const s = makeSession({
      status: 'running',
      currentTool: { name: 'Bash', input: { command: 'npm test' } }
    })
    const dying = { ...s, dyingAt: Math.floor(Date.now() / 1000) }
    const row = renderRowPresentation(dying, 30)
    expect(row.iconId).toBe('circle-slash')
    expect(row.iconColor).toBe('descriptionForeground')
    expect(row.description.startsWith('已退出 · ')).toBe(true)
    // dying 时不暴露 currentTool (跟现有规则一致:wait 之外不暴露)
    expect(row.label).toBe('my-app')  // 没拼 toolSummary
  })
})