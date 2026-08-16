import { describe, it, expect } from 'vitest'
import { summarizeTool } from '../util/toolSummary.js'

describe('summarizeTool', () => {
  it('Bash: 命令本体(空白归一化)', () => {
    expect(summarizeTool({
      name: 'Bash',
      input: { command: 'git   push   --force   origin  main' }
    })).toBe('git push --force origin main')
  })

  it('Bash: 截断长命令到 60 字符 + …', () => {
    const long = 'echo ' + 'x'.repeat(80)
    const out = summarizeTool({ name: 'Bash', input: { command: long } })
    expect(out.length).toBe(60)
    expect(out.endsWith('…')).toBe(true)
  })

  it('Bash: input 不是字符串时降级到 tool name', () => {
    expect(summarizeTool({ name: 'Bash', input: { command: 123 } })).toBe('Bash')
    expect(summarizeTool({ name: 'Bash', input: {} })).toBe('Bash')
    expect(summarizeTool({ name: 'Bash', input: null })).toBe('Bash')
  })

  it('Edit / Write / MultiEdit / Read: 取 file_path 的 basename', () => {
    expect(summarizeTool({ name: 'Edit',     input: { file_path: '/home/me/proj/src/auth.ts' } })).toBe('auth.ts')
    expect(summarizeTool({ name: 'Write',    input: { file_path: '/a/b/c.ts' } })).toBe('c.ts')
    expect(summarizeTool({ name: 'MultiEdit',input: { file_path: '/x/y/z.json' } })).toBe('z.json')
    expect(summarizeTool({ name: 'Read',     input: { file_path: '/srv/app/main.go' } })).toBe('main.go')
  })

  it('文件类工具:file_path 缺失/非字符串 → 降级到 tool name', () => {
    expect(summarizeTool({ name: 'Edit', input: {} })).toBe('Edit')
    expect(summarizeTool({ name: 'Write', input: { file_path: 42 } })).toBe('Write')
    expect(summarizeTool({ name: 'Read', input: null })).toBe('Read')
  })

  it('Windows 路径用 \\ 分隔:node:path.basename 正确处理', () => {
    // 原生 Windows Claude Code 会发 C:\Users\me\src\auth.ts 这种路径
    expect(summarizeTool({ name: 'Edit', input: { file_path: 'C:\\Users\\me\\src\\auth.ts' } })).toBe('auth.ts')
    expect(summarizeTool({ name: 'Write', input: { file_path: 'D:\\proj\\main.go' } })).toBe('main.go')
    expect(summarizeTool({ name: 'Read', input: { file_path: 'C:\\a\\b\\c\\d\\e\\deep.ts' } })).toBe('deep.ts')
  })

  it('POSIX 路径仍正确(POSIX 模式下 node:path.basename 用 /)', () => {
    expect(summarizeTool({ name: 'Edit', input: { file_path: '/home/me/proj/auth.ts' } })).toBe('auth.ts')
    expect(summarizeTool({ name: 'Read', input: { file_path: '/srv/app/main.go' } })).toBe('main.go')
  })

  it('WebFetch: url 截断', () => {
    expect(summarizeTool({ name: 'WebFetch', input: { url: 'https://example.com/path' } })).toBe('https://example.com/path')
    const long = 'https://example.com/' + 'a'.repeat(80)
    const out = summarizeTool({ name: 'WebFetch', input: { url: long } })
    expect(out.length).toBe(60)
    expect(out.endsWith('…')).toBe(true)
  })

  it('未知工具:仅 tool name', () => {
    expect(summarizeTool({ name: 'Task', input: { description: 'do stuff' } })).toBe('Task')
    expect(summarizeTool({ name: 'Glob', input: { pattern: '**/*.ts' } })).toBe('Glob')
  })

  it('input 是数组/原始值时降级到 tool name', () => {
    expect(summarizeTool({ name: 'Bash', input: ['a', 'b'] as unknown })).toBe('Bash')
    expect(summarizeTool({ name: 'Bash', input: 'plain string' })).toBe('Bash')
    expect(summarizeTool({ name: 'Bash', input: 42 })).toBe('Bash')
  })
})