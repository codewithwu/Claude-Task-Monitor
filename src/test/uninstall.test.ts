import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { runUninstall } from '../uninstall.js'
import { OWNER_TAG } from '../installer.js'

// 09-05 P0 #2:验证 vscode:uninstall 入口(被 package.json scripts 调起)的
// 纯函数核心 runUninstall —— 不依赖 vscode mock,纯 fs。

let home: string
let settingsDir: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ctm-uninstall-'))
  settingsDir = path.join(home, '.claude')
  fs.mkdirSync(settingsDir, { recursive: true })
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
})

describe('runUninstall', () => {
  it('混合 hooks:仅移除本扩展条目,用户原 hooks 保留', () => {
    const settingsPath = path.join(settingsDir, 'settings.json')
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-hook' }] },
              {
                _owner: OWNER_TAG,
                matcher: '*',
                hooks: [{ type: 'command', command: '~/.claude-task-monitor/hook.sh' }]
              }
            ]
          }
        },
        null,
        2
      )
    )

    const r = runUninstall({ home })
    expect(r.ok).toBe(true)

    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    expect(after.hooks.PreToolUse).toHaveLength(1)
    expect(after.hooks.PreToolUse[0].hooks[0].command).toBe('echo user-hook')
  })

  it('settings.json 不存在 + hook.sh 不存在 → ok:true,无副作用', () => {
    const r = runUninstall({ home })
    expect(r.ok).toBe(true)
    expect(fs.existsSync(path.join(settingsDir, 'settings.json'))).toBe(false)
    expect(fs.existsSync(path.join(home, '.claude-task-monitor', 'hook.sh'))).toBe(false)
  })

  it('settings.json 中无本扩展条目 → 内容不变', () => {
    const settingsPath = path.join(settingsDir, 'settings.json')
    const payload = {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo x' }] }]
      }
    }
    const serialized = JSON.stringify(payload, null, 2)
    fs.writeFileSync(settingsPath, serialized)

    const r = runUninstall({ home })
    expect(r.ok).toBe(true)
    // 与 installHookAssets 的 #9 优化对称:内容相等 → 不写回
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(serialized)
  })

  it('删除 ~/.claude-task-monitor/hook.sh', () => {
    const hookPath = path.join(home, '.claude-task-monitor', 'hook.sh')
    fs.mkdirSync(path.dirname(hookPath), { recursive: true })
    fs.writeFileSync(hookPath, '#!/usr/bin/env bash\necho hi\n', { mode: 0o755 })

    const r = runUninstall({ home })
    expect(r.ok).toBe(true)
    expect(fs.existsSync(hookPath)).toBe(false)
  })

  it('settings.json 是 7 个 hook 事件全占 → 卸载后 hooks 块被清空 / 键被移除', () => {
    // 模拟 activate 自动安装后的状态:每个事件下都有 1 条 OWNER_TAG 条目
    const settingsPath = path.join(settingsDir, 'settings.json')
    const events = [
      'SessionStart',
      'SessionEnd',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'Notification',
      'Stop'
    ]
    const payload = {
      hooks: Object.fromEntries(
        events.map(ev => [
          ev,
          [{ _owner: OWNER_TAG, hooks: [{ type: 'command', command: '~/.claude-task-monitor/hook.sh' }] }]
        ])
      )
    }
    fs.writeFileSync(settingsPath, JSON.stringify(payload, null, 2))

    const r = runUninstall({ home })
    expect(r.ok).toBe(true)

    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    expect(after.hooks).toBeUndefined()
  })

  it('settings.json 是损坏的 JSON → 不抛异常,仍删 hook.sh', () => {
    const settingsPath = path.join(settingsDir, 'settings.json')
    fs.writeFileSync(settingsPath, '{ not json ::: }')
    const hookPath = path.join(home, '.claude-task-monitor', 'hook.sh')
    fs.mkdirSync(path.dirname(hookPath), { recursive: true })
    fs.writeFileSync(hookPath, '#!/usr/bin/env bash\n', { mode: 0o755 })

    const r = runUninstall({ home })
    expect(r.ok).toBe(true)
    expect(fs.existsSync(hookPath)).toBe(false)
  })
})
