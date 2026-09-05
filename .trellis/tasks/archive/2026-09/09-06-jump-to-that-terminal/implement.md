# Implement — 跳转到「那个终端」

> 设计: `design.md`. 需求: `prd.md`. 验收: `prd.md#Acceptance Criteria`.

## 执行顺序

### 1. 底层: `src/util/pidAncestor.ts` + 单测

- 新增文件 `src/util/pidAncestor.ts`,导出 `walkUpToComm(pid, target, opts?)`
- 实现见 `design.md#walkUpToCommpid-target--srcutilpidancestorts`
- 不引入新依赖

### 2. 单测: `src/util/pidAncestor.test.ts`

- **用例 1**: 构造 `bash → node → claude` 进程树 (真子进程 + `setSelfComm`),验证 `walkUpToComm(bashPid, 'claude')` 返回 `claudePid`
- **用例 2**: 起始 PID 本身就是 `claude` → 直接返回自己
- **用例 3**: 进程链无 `claude` → 返回 null
- **用例 4**: `pid = 0 / 负数 / undefined` → 返回 null,不抛
- **用例 5**: timeout 触发 → 返回 null
- 跨平台: Linux 跑全套; macOS 通过 `process.platform === 'darwin'` 分支时跳过不兼容的 fixture (warn),逻辑分支由 Linux 用例间接覆盖

### 3. 上层: `src/util/findClaudeTerminal.ts` + 单测

- 新增文件,导出 `findClaudeTerminal(s: SessionState): Promise<vscode.Terminal | null>`
- 实现见 `design.md#findterminalbypids--srcutilfindclaudeterminalts`
- **单测** `src/util/findClaudeTerminal.test.ts`:
  - mock `vscode.window.terminals`:返回 N 个 fake terminal,fake `processId` + fake `creationOptions.cwd`
  - **用例 1**: 0 个 terminal → null
  - **用例 2**: 1 个 terminal,processId undefined → null
  - **用例 3**: 1 个 terminal,PID 链命中且 cwd 匹配 → 返该 terminal
  - **用例 4**: 2 个 terminal 都命中,一个 cwd 匹配 / 一个不匹配 → 返 cwd 匹配那个
  - **用例 5**: 2 个 terminal 都命中且 cwd 都匹配 → 返第一个 (并列降级)
  - **用例 6**: 全部未命中 → null
  - **用例 7**: s.pid undefined → null (短路,不调 walkUpToComm)
  - **用例 8**: walkUpToComm 返回慢 (Promise 不 resolve) → 200ms 后超时,整体不挂

### 4. i18n

- `src/i18n/messages/zh.ts` 加 `toast.terminal.notFound`
- `src/i18n/messages/en.ts` 同名 key
- 文案见 `design.md#openclaudeterminals--srcextensionts467-改写`

### 5. 集成: 改 `src/extension.ts:467`

- `openClaudeTerminal` 改 async,先 `await findClaudeTerminal(s)`,命中即 `term.show()` 返;未命中走 fallback + toast
- 不动调用点 (`openInTerminalCommand` 已经是 fire-and-forget,包个 `void` 兼容 async 即可)

### 6. 编译 / 类型 / Lint

```bash
pnpm build          # tsc + esbuild,确保 noEmit 不通过则不会产出 .vsix
pnpm lint           # 现有 ESLint 配置
pnpm typecheck      # 若有独立 tsc --noEmit 脚本
```

### 7. 测试全量

```bash
pnpm vitest run
```

- 必须绿:`src/util/pidAncestor.test.ts` / `src/util/findClaudeTerminal.test.ts` (新)
- 必须不回归:`src/test/{hook,liveness,notifier,stateManager}.test.ts`

### 8. 手动 smoke (不在 CI 内,本地执行)

- 启动扩展 dev host (F5)
- 在集成终端跑 `claude`,触发 hook,sidebar 出现 session
- 右键 → "Open in Terminal" → **不新开,聚焦原 tab**
- 关闭原 terminal,在外部终端 (iTerm) 跑 claude → 触发 hook → 点 "Open in Terminal" → **新开 + 弹 toast**

## 风险文件 / 回滚点

| 文件 | 风险 | 回滚 |
|------|------|------|
| `src/util/pidAncestor.ts` | 新文件,跨平台分支 bug | 删除即可,不影响其他路径 |
| `src/util/findClaudeTerminal.ts` | 新文件,vscode API mock 边界 | 删除 |
| `src/extension.ts:467-470` | 改写后调用者需 `void` | revert 即可恢复 createTerminal 行为 |
| `src/i18n/messages/{zh,en}.ts` | 加 key 后翻译缺失 → UI 显 t('key') 字面量 | 回滚 commit 或补翻译 |

## commit 计划

1 个 commit,标题:`feat(sidebar): focus the terminal running Claude instead of opening a new one (#4)`

Body:
- 关联 `notes/improvement-backlog.md#4` + `README.md#已知局限` 第二条
- 列出新增文件、修改文件、跨平台分支决策
- 引用 PRD Q1=B 决议

## 复盘 checklist (review 时对照)

- [ ] PRD AC1-AC8 全部可演示 / 可断言
- [ ] `walkUpToComm` Linux + macOS 双测覆盖
- [ ] `findClaudeTerminal` 8 个单测全绿
- [ ] toast 文案中英双语落地
- [ ] `pnpm vitest run` 全绿
- [ ] `pnpm build` 无 type error
- [ ] 未触及 `resources/hook.sh`、`src/liveness.ts`、`src/stateManager.ts`
- [ ] README 已知局限第二行的"外部终端不能聚焦"在内部 terminal 路径已解决 → 决定是否改 README
