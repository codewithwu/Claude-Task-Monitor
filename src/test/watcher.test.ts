import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SessionsWatcher } from '../watcher.js'

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
