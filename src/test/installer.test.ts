import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { writeHookScript, mergeSettings, OWNER_TAG } from '../installer'

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
