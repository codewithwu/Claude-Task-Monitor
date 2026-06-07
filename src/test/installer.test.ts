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
