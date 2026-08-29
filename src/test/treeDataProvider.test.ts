// 08-29 R2:tooltip markdown 注入防御回归测试。
//
// 背景:treeDataProvider.buildTooltip 把 s.lastUserPrompt 和 currentTool.input
// 直接拼进 MarkdownString.appendMarkdown —— 后者不转义 markdown 元字符,
// 用户输入含 [label](url) 时渲染成可点链接。
//
// 修复:用户输入改走 MarkdownString.appendText (字面字符,不解析)。
//
// 测试策略:spy MarkdownString 实例,记录每次 appendText / appendMarkdown
// 调用,断言用户输入只通过 appendText 渲染,受控字符串仍走 appendMarkdown。
// (实际渲染由 VS Code host 负责,单元测试只能验证调用路径.)

import { describe, it, expect, vi, beforeEach } from 'vitest'

interface MdCall { method: 'appendText' | 'appendMarkdown'; args: string[] }
const mdSpies: MdCall[] = []

vi.mock('vscode', () => ({
  env: { language: 'zh-cn' },
  TreeItem: class {
    label: any
    iconPath: any
    description: any
    tooltip: any
    contextValue: any
    command: any
    constructor(label?: any) { this.label = label }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(public id: string, public color?: any) {} },
  ThemeColor: class { constructor(public id: string) {} },
  Uri: {
    file: (p: string) => ({ fsPath: p, scheme: 'file', path: p })
  },
  EventEmitter: class {
    event: any
    constructor() { this.event = () => {} }
    fire() {}
    dispose() {}
  },
  MarkdownString: class {
    value = ''
    isTrusted = false
    supportThemeIcons = false
    appendText(s: string) {
      mdSpies.push({ method: 'appendText', args: [s] })
      this.value += s
      return this
    }
    appendMarkdown(s: string) {
      mdSpies.push({ method: 'appendMarkdown', args: [s] })
      this.value += s
      return this
    }
  }
}))

// imports 必须放在 vi.mock 之后 (vitest hoist,但显式更稳)
import { SessionTreeDataProvider } from '../treeDataProvider.js'
import { SessionStore } from '../stateManager.js'

beforeEach(() => {
  mdSpies.length = 0
})

describe('SessionTreeDataProvider.buildTooltip markdown injection (08-29 R2)', () => {
  it('lastUserPrompt 通过 appendText 渲染,不解释 markdown', () => {
    const store = new SessionStore()
    const provider = new SessionTreeDataProvider(store)
    store.apply({
      hook_event_name: 'SessionStart',
      session_id: 'sess-prompt',
      cwd: '/home/me/proj',
      ts: 1,
      pid: 99999
    })
    store.apply({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-prompt',
      cwd: '/home/me/proj',
      ts: 2,
      user_prompt: '[Click here](https://evil.example/p)'
    })

    const realState = store.get('sess-prompt')!
    provider.getTreeItem(realState)

    const promptTextCalls = mdSpies.filter(c =>
      c.method === 'appendText' && c.args[0].startsWith('Prompt:')
    )
    const promptMdCalls = mdSpies.filter(c =>
      c.method === 'appendMarkdown' && c.args[0].startsWith('Prompt:')
    )
    expect(promptTextCalls).toHaveLength(1)
    expect(promptMdCalls).toHaveLength(0)
    // 字面字符透传,appendText 不解析 markdown
    expect(promptTextCalls[0].args[0]).toContain('[Click here](https://evil.example/p)')
  })

  it('currentTool.input 通过 appendText 渲染,不受 trust 影响', () => {
    const store = new SessionStore()
    const provider = new SessionTreeDataProvider(store)
    store.apply({
      hook_event_name: 'SessionStart',
      session_id: 'sess-tool',
      cwd: '/home/me/proj',
      ts: 1,
      pid: 99999
    })
    store.apply({
      hook_event_name: 'PreToolUse',
      session_id: 'sess-tool',
      cwd: '/home/me/proj',
      ts: 2,
      tool_name: 'Bash',
      tool_input: { command: 'echo [Click](https://evil.example)' }
    })

    const realState = store.get('sess-tool')!
    provider.getTreeItem(realState)

    const toolTextCalls = mdSpies.filter(c =>
      c.method === 'appendText' && c.args[0].startsWith('Tool:')
    )
    const toolMdCalls = mdSpies.filter(c =>
      c.method === 'appendMarkdown' && c.args[0].startsWith('Tool:')
    )
    expect(toolTextCalls).toHaveLength(1)
    expect(toolMdCalls).toHaveLength(0)
    expect(toolTextCalls[0].args[0]).toContain('[Click](https://evil.example)')
  })

  it('受控字符串 (basename / status / sessionId) 仍走 appendMarkdown', () => {
    const store = new SessionStore()
    const provider = new SessionTreeDataProvider(store)
    store.apply({
      hook_event_name: 'SessionStart',
      session_id: 'fixed-uuid-abc',
      cwd: '/home/me/proj',
      ts: 1,
      pid: 99999
    })

    const realState = store.get('fixed-uuid-abc')!
    provider.getTreeItem(realState)

    const mdCalls = mdSpies.filter(c => c.method === 'appendMarkdown')
    // 期望至少 3 个 appendMarkdown 调用:
    //   1. basename 粗体 + status 行
    //   2. cwd 行
    //   3. sessionId 行
    expect(mdCalls.length).toBeGreaterThanOrEqual(3)
    // basename 用粗体标记
    expect(mdCalls.some(c => c.args[0].includes('**'))).toBe(true)
    // sessionId 走代码块
    expect(mdCalls.some(c => c.args[0].includes('fixed-uuid-abc'))).toBe(true)
  })

  it('lastUserPrompt 为空时不调 Prompt 行', () => {
    const store = new SessionStore()
    const provider = new SessionTreeDataProvider(store)
    store.apply({
      hook_event_name: 'SessionStart',
      session_id: 'sess-no-prompt',
      cwd: '/home/me/proj',
      ts: 1,
      pid: 99999
    })
    // 不发 UserPromptSubmit,lastUserPrompt 保持 ''

    const realState = store.get('sess-no-prompt')!
    provider.getTreeItem(realState)

    const promptCalls = mdSpies.filter(c => c.args[0].startsWith('Prompt:'))
    expect(promptCalls).toHaveLength(0)
  })
})