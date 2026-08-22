import { describe, it, expect, vi } from 'vitest'
import { formatSingleMessage, formatAggregateMessage } from '../util/notifyMessage.js'
import type { WaitingSession } from '../notifier.js'

// notifyMessage 走 i18n,i18n 内部 import vscode.
// vi.mock 占位让模块解析通过;language 设为 'zh-cn' 跟既有断言对齐 (测试期望中文文案)
vi.mock('vscode', () => ({ env: { language: 'zh-cn' } }))

function s(sessionId: string, toolName: string, cwd: string): WaitingSession {
  return { sessionId, toolName, cwd }
}

describe('formatSingleMessage', () => {
  it('沿用旧格式:name + 等待权限确认 + toolName', () => {
    expect(formatSingleMessage(s('a', 'Bash', '/home/me/proj')))
      .toBe('proj 等待权限确认：Bash')
  })

  it('cwd 为根时 fallback 到 cwd 字符串', () => {
    expect(formatSingleMessage(s('a', 'Edit', '/')))
      .toBe('/ 等待权限确认：Edit')
  })

  it('Windows cwd 路径(用 \\ 分隔)取 basename', () => {
    // 原生 Windows Claude Code
    expect(formatSingleMessage(s('a', 'Edit', 'C:\\Users\\me\\proj\\src')))
      .toBe('src 等待权限确认：Edit')
  })
})

describe('formatAggregateMessage', () => {
  it('2 个会话:列出全部', () => {
    const msg = formatAggregateMessage([
      s('a', 'Bash', '/p/foo'),
      s('b', 'Edit', '/p/bar')
    ])
    expect(msg).toBe('2 个会话正在等待：foo, bar')
  })

  it('3 个会话:列出全部', () => {
    const msg = formatAggregateMessage([
      s('a', 'Bash', '/p/one'),
      s('b', 'Edit', '/p/two'),
      s('c', 'Write', '/p/three')
    ])
    expect(msg).toBe('3 个会话正在等待：one, two, three')
  })

  it('5 个会话:列前 3 个 + "等 5 个"', () => {
    const msg = formatAggregateMessage([
      s('a', 'Bash', '/p/one'),
      s('b', 'Edit', '/p/two'),
      s('c', 'Write', '/p/three'),
      s('d', 'Bash', '/p/four'),
      s('e', 'Bash', '/p/five')
    ])
    expect(msg).toBe('5 个会话正在等待：one, two, three 等 5 个')
  })

  it('Windows 路径(用 \\ 分隔)正确取 basename', () => {
    const msg = formatAggregateMessage([
      s('a', 'Edit', 'C:\\Users\\me\\foo'),
      s('b', 'Bash', 'D:\\proj\\bar')
    ])
    expect(msg).toBe('2 个会话正在等待：foo, bar')
  })
})