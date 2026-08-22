import { describe, it, expect } from 'vitest'
import { groupByStatus, applyFilter } from '../util/groupByStatus.js'
import { SessionGroup } from '../types.js'
import type { SessionState } from '../types.js'

function makeSession(status: SessionState['status'], sessionId: string): SessionState {
  return {
    sessionId,
    cwd: `/tmp/${sessionId}`,
    status,
    stateChangedAt: 0,
    lastUserPrompt: '',
    currentTool: null,
    fileOffset: 0
  }
}

describe('groupByStatus', () => {
  it('filter=all + 各 status 都有 session:按 Waiting→Running→Idle 顺序返回 3 个 group', () => {
    const sessions = [
      makeSession('idle', 'a'),
      makeSession('running', 'b'),
      makeSession('waiting', 'c')
    ]
    const groups = groupByStatus(sessions, 'all')
    expect(groups.map(g => g.status)).toEqual(['waiting', 'running', 'idle'])
  })

  it('filter=all + 空 list:返回 0 个 group (避免空 group 噪音)', () => {
    expect(groupByStatus([], 'all')).toEqual([])
  })

  it('filter=all + 只有 waiting:只返回 Waiting group,跳过空 Running/Idle', () => {
    const sessions = [makeSession('waiting', 'a'), makeSession('waiting', 'b')]
    const groups = groupByStatus(sessions, 'all')
    expect(groups).toHaveLength(1)
    expect(groups[0]).toBeInstanceOf(SessionGroup)
    expect(groups[0].status).toBe('waiting')
  })

  it('filter=waiting + 无 waiting session:仍返回 1 个 Waiting group (指示过滤模式生效)', () => {
    const sessions = [makeSession('running', 'a')]
    const groups = groupByStatus(sessions, 'waiting')
    expect(groups).toHaveLength(1)
    expect(groups[0].status).toBe('waiting')
  })

  it('filter=running / idle 单值模式:只返回对应 group', () => {
    expect(groupByStatus([], 'running').map(g => g.status)).toEqual(['running'])
    expect(groupByStatus([], 'idle').map(g => g.status)).toEqual(['idle'])
  })
})

describe('applyFilter', () => {
  it('filter=all:返回原列表的副本', () => {
    const sessions = [makeSession('waiting', 'a'), makeSession('idle', 'b')]
    const out = applyFilter(sessions, 'all')
    expect(out).toEqual(sessions)
    // 应该是新数组 (避免 caller mutate 原 list 污染 store 视图)
    expect(out).not.toBe(sessions)
  })

  it('filter=waiting:只保留 waiting session', () => {
    const sessions = [
      makeSession('waiting', 'a'),
      makeSession('running', 'b'),
      makeSession('waiting', 'c')
    ]
    const out = applyFilter(sessions, 'waiting')
    expect(out.map(s => s.sessionId)).toEqual(['a', 'c'])
  })

  it('filter=running / idle:对应 status', () => {
    const sessions = [
      makeSession('waiting', 'a'),
      makeSession('running', 'b'),
      makeSession('idle', 'c')
    ]
    expect(applyFilter(sessions, 'running').map(s => s.sessionId)).toEqual(['b'])
    expect(applyFilter(sessions, 'idle').map(s => s.sessionId)).toEqual(['c'])
  })

  it('filter=waiting + 无匹配:返回空数组 (不返回原列表)', () => {
    const sessions = [makeSession('running', 'a')]
    expect(applyFilter(sessions, 'waiting')).toEqual([])
  })
})