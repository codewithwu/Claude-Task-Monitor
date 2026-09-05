# Design — P0 #2 卸载对话框拆分

## 1. 架构分层

```
                    ┌──────────────────────────────────────┐
   Reload/关窗/禁用 │  src/extension.ts   deactivate()     │
                    │  ────────────────────────────────    │
                    │   • watcher.close()                  │
                    │   • leaderLock.stop()                │
                    │   • 释放所有 context.subscriptions   │
                    │   ❌ 不再弹 showInformationMessage    │
                    │   ❌ 不再调 uninstallSettings/unlink │
                    └──────────────────────────────────────┘

                    ┌──────────────────────────────────────┐
   卸载扩展          │  scripts.uninstall  →  dist/uninstall.js
                    │  (package.json: "vscode:uninstall")  │
                    │  ────────────────────────────────    │
                    │   • runUninstall({ home, root })      │
                    │     - 读 ~/.claude/settings.json      │
                    │     - 调 uninstallSettings()          │
                    │     - 写回(若改动)                    │
                    │     - unlink ~/.claude-task-monitor/  │
                    │       hook.sh                         │
                    │   • 任何异常 console.warn,exit 0     │
                    └──────────────────────────────────────┘
```

## 2. 模块边界

| 模块 | 运行环境 | 依赖 | 是否能 import `vscode` |
|---|---|---|---|
| `src/extension.ts` (deactivate) | Extension Host | `vscode`, `installer`, `util/*` | ✅ 是 |
| `src/installer.ts` (uninstallSettings) | Node | `node:fs`, `node:path` | ❌ 否(已经无 vscode 依赖,直接复用) |
| `src/uninstall.ts` (新) | Node CLI | `installer.ts` + `node:os` | ❌ 否 |
| `tsup` entry | build time | tsup | n/a |

**关键**:`installer.ts` 已经是纯 Node(只引 `node:fs` / `node:child_process`),可以直接被 `uninstall.ts` 复用,**无需抽包**。

## 3. 关键决策

### D1:不抽到独立 npm 包
- `installer.ts` 已无 `vscode` 依赖 → 编译产物直接 `require('./installer')` 即可。
- 抽包会让增量构建变复杂、对 `#11 干掉 jq` 不利。

### D2:`uninstall.ts` 设计为可测函数 + 薄壳 main
```ts
// src/uninstall.ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { uninstallSettings } from './installer.js'

export function runUninstall(opts: { home: string; root: string }): { ok: boolean; error?: string } {
  // 同现有 deactivate() 卸载分支,但参数化路径便于测试
}

if (require.main === module) {
  const r = runUninstall({ home: os.homedir(), root: path.join(os.homedir(), '.claude-task-monitor') })
  if (!r.ok) console.warn('[claude-task-monitor] uninstall:', r.error)
}
```

### D3:`tsup` 增加第二个 entry

`tsup.config.ts`:
```ts
entry: { extension: 'src/extension.ts', uninstall: 'src/uninstall.ts' }
```

产出 `dist/extension.js` + `dist/uninstall.js`,跟现有 `package.json main` 兼容。

### D4:`vscode:uninstall` 走已编译产物
- 不能跑 `tsx` / `ts-node`(依赖不一定装,vsce 打包后只带 `dist/`)。
- `package.json` 写 `node ./dist/uninstall.js`。

### D5:`deactivate()` 删除的精确边界

**删**:
- 整个 `t('extension.uninstall.*')` 的 import / 用法
- `uninstallSettings` import
- `if (fs.existsSync(CLAUDE_SETTINGS)) ...` 块
- `if (fs.existsSync(HOOK_SCRIPT)) fs.unlinkSync(HOOK_SCRIPT)`

**留**:
- `deactivate(): void { ... }` 壳
- `context.subscriptions` 在 activate 里 dispose 的逻辑——那些由 VS Code 自动调用,不需 deactivate 显式重做
- 注释:`deactivate()` 仅做 best-effort 资源释放

## 4. 路径常量

不在 `uninstall.ts` 里重新定义路径,改从 `installer.ts` 导出(若已有就复用,否则新增 2 行):

```ts
// installer.ts 新增 export
export const HOOK_SCRIPT_REL = '.claude-task-monitor/hook.sh'
export const CLAUDE_SETTINGS_REL = '.claude/settings.json'
```

`uninstall.ts`:
```ts
const home = opts.home ?? os.homedir()
const hookPath = path.join(home, HOOK_SCRIPT_REL)
const settingsPath = path.join(home, CLAUDE_SETTINGS_REL)
```

这样测试可以传 `tmpDir` 当 home,完全隔离。

## 5. 错误处理契约

`runUninstall` 返回 `{ ok: boolean, error?: string }`,**不抛异常**:

- `settings.json` 不存在 → `ok: true`(无须清理)
- `settings.json` JSON 损坏 → `ok: false, error: '<msg>'`(让脚本 exit 0,但 stderr 留痕)
- `hook.sh` 不存在 → `ok: true`
- 任何 `EACCES` / `EPERM` → `ok: false, error: '<msg>'`

CLI 入口:即便 `ok: false`,也 exit 0(卸载已经发生,反复报错对用户没价值;日志进 console 即可)。

## 6. 测试策略

`src/test/uninstall.test.ts` 新增:

1. **混合 hooks**:seed 含 1 条用户 hook + 1 条我们的,运行 → 用户的还在,我们的消失。
2. **空 settings**:`settings.json` 不存在,`hook.sh` 也不存在 → `ok: true`,无副作用。
3. **settings 改动等于原内容**:seed 一个完全没有我们 hook 的 settings,运行 → 不写回文件(mtime 不变)。「幂等」语义与现有 `installer.test.ts` 对齐。
4. **删除 hook.sh**:seed `hook.sh`,运行 → 文件消失。

不需要 mock `vscode`,纯 fs 测试。import:

```ts
import { runUninstall } from '../uninstall.js'
```

## 7. 兼容性

| 方面 | 影响 |
|---|---|
| 用户升级路径 | `deactivate()` 静默化无破坏;卸载走新路径,清理结果一致 |
| `package.json main` | 仍指向 `dist/extension.js`,不变 |
| `vscode:prepublish` | 不变,仍 `pnpm build` |
| CI / release 脚本 | 不变 |
| `tsup` `clean: true` | 仍清理 dist,避免 stale uninstall.js |
