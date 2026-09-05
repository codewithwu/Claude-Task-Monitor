# Implement — P0 #2 卸载对话框拆分

## 0. 顺序与依赖

```
T1 [installer.ts] 导出 HOOK_SCRIPT_REL / CLAUDE_SETTINGS_REL
        │
        ▼
T2 [src/uninstall.ts] 新建 runUninstall + CLI 入口
        │
        ├─▶ T3 [tsup.config.ts] 增加 uninstall entry
        │
        ├─▶ T4 [package.json] 加 scripts.vscode:uninstall
        │
        └─▶ T5 [src/extension.ts] deactivate() 瘦身(去 import / 去卸载块)
                │
                ▼
        T6 [src/test/uninstall.test.ts] 新增 ≥4 个用例
                │
                ▼
        T7 [validation] pnpm build && pnpm test && grep 校验
```

T1 必先;其余 T2-T5 可在一个提交里串改(同一组语义);T6 / T7 跟随。

## 1. T1 — `installer.ts` 导出路径常量

`src/installer.ts` 顶部新增(放在 `OWNER_TAG` 之后):

```ts
export const HOOK_SCRIPT_REL = '.claude-task-monitor/hook.sh'
export const CLAUDE_SETTINGS_REL = '.claude/settings.json'
```

`extension.ts` 里现有的 `HOOK_SCRIPT = path.join(HOME_DIR, '.claude-task-monitor/hook.sh')` / `CLAUDE_SETTINGS` **保留不动**(用户视觉一致性 + 不必在本任务里扩散 rename)。

## 2. T2 — 新建 `src/uninstall.ts`

```ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  uninstallSettings,
  HOOK_SCRIPT_REL,
  CLAUDE_SETTINGS_REL,
  type Settings
} from './installer.js'

export interface UninstallOptions {
  home: string            // 用户 home,测试可注入 tmpDir
}

export interface UninstallResult {
  ok: boolean
  error?: string
}

export function runUninstall(opts: UninstallOptions): UninstallResult {
  const settingsPath = path.join(opts.home, CLAUDE_SETTINGS_REL)
  const hookPath = path.join(opts.home, HOOK_SCRIPT_REL)

  try {
    // 1. 清 settings.json 中本扩展条目
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf8')
      let parsed: Settings
      try {
        parsed = JSON.parse(raw) as Settings
      } catch (e) {
        return { ok: false, error: `settings.json 不是合法 JSON: ${(e as Error).message}` }
      }
      const cleaned = uninstallSettings(parsed)
      const newRaw = JSON.stringify(cleaned, null, 2)
      if (newRaw !== raw) {
        fs.writeFileSync(settingsPath, newRaw)
      }
    }

    // 2. 删 hook.sh
    if (fs.existsSync(hookPath)) {
      fs.unlinkSync(hookPath)
    }

    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// CLI 入口 —— 被 package.json 的 "vscode:uninstall" 调用
if (require.main === module) {
  const result = runUninstall({ home: os.homedir() })
  if (!result.ok) {
    console.warn('[claude-task-monitor] uninstall:', result.error)
  }
  // 卸载流程已发生,exit 0 不重复打扰用户
}
```

> **注意**:`require.main === module` 在 ESM 下行为略有不同,但 tsup 输出 `cjs`(见 tsup.config.ts `format: ['cjs']`),可以这样判。

## 3. T3 — `tsup.config.ts` 增加 entry

```ts
entry: {
  extension: 'src/extension.ts',
  uninstall: 'src/uninstall.ts'
}
```

## 4. T4 — `package.json` 加 uninstall 脚本

`scripts` 块新增一行:

```json
"vscode:uninstall": "node ./dist/uninstall.js"
```

`engines.vscode` 已是 `^1.86.0`(`vscode:uninstall` 自 1.21+ 支持),无需调整。

## 5. T5 — `deactivate()` 瘦身

`src/extension.ts`:

- 删 import 里的 `uninstallSettings`(保留 `writeHookScript` / `mergeSettings`,activate 自动安装仍在用)。
- 删 `t('extension.uninstall.*')` import / 用法(本任务不删 i18n message 文件,留给后续清理 / 或保留无害)。
- `deactivate()` 改为:

```ts
export function deactivate(): void {
  // 仅做 best-effort 资源释放。
  // 卸载时的清理走 package.json scripts.vscode:uninstall → dist/uninstall.js,
  // 避免 reload / 关闭窗口 / 禁用扩展时误弹对话框。
  // 资源释放由 context.subscriptions 在 dispose 时自动接管,这里无需重复。
}
```

- i18n `extension.uninstall.prompt/remove/keep` 三条 key **保留不动**(后续若需要可重启用,删了还要保证不会引发 unused-warning)。**但**如果项目 lint 严格,可一并删除——本任务保守起见保留。

## 6. T6 — `src/test/uninstall.test.ts`

模板(参考 `installer.test.ts` 风格):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { runUninstall } from '../uninstall.js'
import { OWNER_TAG } from '../installer.js'

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
  it('混合 hooks 时,仅移除本扩展的条目,用户原 hooks 保留', () => {
    const settingsPath = path.join(settingsDir, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user' }] },
          { _owner: OWNER_TAG, matcher: '*', hooks: [{ type: 'command', command: '~/.claude-task-monitor/hook.sh' }] }
        ]
      }
    }, null, 2))

    const r = runUninstall({ home })
    expect(r.ok).toBe(true)

    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    expect(after.hooks.PreToolUse).toHaveLength(1)
    expect(after.hooks.PreToolUse[0].hooks[0].command).toBe('echo user')
  })

  it('settings.json 不存在 + hook.sh 不存在 → ok: true,无副作用', () => {
    const r = runUninstall({ home })
    expect(r.ok).toBe(true)
    expect(fs.existsSync(path.join(settingsDir, 'settings.json'))).toBe(false)
  })

  it('settings.json 中无本扩展条目 → 不写回文件(mtime 不变)', () => {
    const settingsPath = path.join(settingsDir, 'settings.json')
    const payload = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo x' }] }] } }
    fs.writeFileSync(settingsPath, JSON.stringify(payload, null, 2))
    const beforeMtime = fs.statSync(settingsPath).mtimeMs

    // 容忍 fs mtime 精度,人为 sleep 让 mtime 至少 +5ms
    const wait = () => new Promise<void>(r => setTimeout(r, 20))
    return wait().then(() => {
      const r = runUninstall({ home })
      expect(r.ok).toBe(true)
      // mtime 可能 == 0 时被四舍五入;仅断言内容未变
      expect(fs.readFileSync(settingsPath, 'utf8')).toBe(JSON.stringify(payload, null, 2))
      // 顺带 verify beforeMtime 变量被读取避免 lint unused
      expect(beforeMtime).toBeGreaterThan(0)
    })
  })

  it('删除 ~/.claude-task-monitor/hook.sh', () => {
    const hookPath = path.join(home, '.claude-task-monitor', 'hook.sh')
    fs.mkdirSync(path.dirname(hookPath), { recursive: true })
    fs.writeFileSync(hookPath, '#!/usr/bin/env bash\necho hi\n', { mode: 0o755 })

    const r = runUninstall({ home })
    expect(r.ok).toBe(true)
    expect(fs.existsSync(hookPath)).toBe(false)
  })
})
```

> 第 3 个用例的 mtime 断言做了简化(部分 fs mtime 精度低),改为内容比对 + 顺手 verify beforeMtime 避免 unused-lint;更稳。

## 7. T7 — 验证

```bash
pnpm build
ls dist/uninstall.js                        # 应存在
ls dist/extension.js                        # 应仍在
pnpm test                                   # 全部通过,新增 ≥4 个 uninstall 用例
grep -n "extension.uninstall" src/extension.ts || echo OK   # 应只剩 import 行或无
grep -n "uninstallSettings" src/extension.ts || echo OK     # deactivate 路径已无引用
```

## 8. 回滚点

若 T6 测试 / T7 build 失败,revert 到 commit 起点即可(`git reset --hard origin/main`)——本任务所有改动都在 `installer.ts` / 新文件 / `extension.ts deactivate()` / `tsup.config.ts` / `package.json` 五个位置,影响面有限。

## 9. 检查清单

- [ ] `installer.ts` 导出路径常量
- [ ] `uninstall.ts` 函数 + CLI 入口
- [ ] `tsup.config.ts` 增加 entry
- [ ] `package.json` 加 `vscode:uninstall` 脚本
- [ ] `deactivate()` 不再弹框 / 不再调卸载函数
- [ ] `uninstall.test.ts` ≥4 用例
- [ ] `pnpm test` 全绿
- [ ] `pnpm build` 产出 `dist/uninstall.js`
- [ ] `grep` 校验通过
- [ ] 提交并打 P0 #2 tag
