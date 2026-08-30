import { describe, it, expect, vi } from 'vitest'
import * as vscode from 'vscode'
import { applyBadge } from '../ui/badge.js'
import type { SessionState, SessionStatus } from '../types.js'
import type { SessionStore } from '../stateManager.js'

// applyBadge 是纯副作用函数(treeView.badge = ...)：
// 用 fake treeView 验证 badge 字段被正确写入。
// tooltip 文案走 i18n,language 显式 mock 为 zh-cn 跟现有断言对齐。
vi.mock('vscode', () => ({ env: { language: 'zh-cn' } }))

function makeFakeTreeView() {
  return { badge: undefined as vscode.ViewBadge | undefined }
}

function makeStore(sessions: SessionState[]): SessionStore {
  const waiting = sessions.filter(s => s.status === 'waiting').length
  return {
    list: () => sessions,
    waitingCount: () => waiting,
    listByStatus: (status: SessionStatus) => sessions.filter(s => s.status === status)
  } as unknown as SessionStore
}

function s(status: 'idle' | 'running' | 'waiting', id = 's'): SessionState {
  return {
    sessionId: id,
    cwd: '/p',
    status,
    stateChangedAt: 0,
    lastUserPrompt: '',
    currentTool: null,
    fileOffset: 0
  }
}

describe('applyBadge', () => {
  // applyBadge 只读 treeView.badge 字段,绕开 TreeView 完整接口的类型校验
  function apply(tv: { badge: vscode.ViewBadge | undefined }, store: SessionStore) {
    applyBadge(tv as unknown as vscode.TreeView<unknown>, store)
  }

  it('无 waiting 时不设置 badge', () => {
    const tv = makeFakeTreeView()
    apply(tv, makeStore([s('idle'), s('running')]))
    expect(tv.badge).toBeUndefined()
  })

  it('1 个 waiting → badge.value = 1', () => {
    const tv = makeFakeTreeView()
    apply(tv, makeStore([s('waiting'), s('idle')]))
    expect(tv.badge?.value).toBe(1)
    expect(tv.badge?.tooltip).toBe('1 个会话正在等待权限确认')
  })

  it('5 个 waiting → badge.value = 5', () => {
    const tv = makeFakeTreeView()
    apply(tv, makeStore([s('waiting'), s('waiting'), s('waiting'), s('waiting'), s('waiting')]))
    expect(tv.badge?.value).toBe(5)
  })

  it('空 store → badge undefined', () => {
    const tv = makeFakeTreeView()
    apply(tv, makeStore([]))
    expect(tv.badge).toBeUndefined()
  })
})