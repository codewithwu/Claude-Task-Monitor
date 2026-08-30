import * as fs from 'node:fs'
import * as path from 'node:path'
import { EventEmitter } from 'node:events'
import chokidar from 'chokidar'
import { formatErrorMessage } from './util/formatError.js'
import { ENDED_DIR_NAME } from './util/archiveName.js'

type WatcherEvents = {
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
      ignored: (p: string) => p.includes(path.sep + ENDED_DIR_NAME),
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
    if (!this.offsets.has(file)) this.offsets.set(file, 0)
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
    let offset = this.offsets.get(file) ?? 0
    if (stat.size < offset) {
      // 文件被截断 (truncate / 写盘失败回滚);从头重新读
      // emit 的事件对 stateManager 是新的 —— 它没看过这些行。
      // 同时把 offsets map 也重置,否则下一次 change 在 stat.size === offset 时
      // 仍会早返 (08-29 R3 修复的 regression)
      offset = 0
      this.offsets.set(file, 0)
    }
    if (stat.size === offset) return

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
          this.emit('parseError', formatErrorMessage(e), file, line)
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