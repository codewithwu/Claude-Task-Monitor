# 跳转到「那个终端」而非新开一个

> Backlog item #4 (P1 功能). 设计: `design.md`. 执行: `implement.md`.

## Goal

当用户在右侧 sidebar 看到红点 / 右键 / 命令面板触发「在终端中打开」时，**直接聚焦那个已经在跑 claude 的终端 tab**，而不是新开一个相同 cwd 的空终端。把"看到红点 → 切窗口 → 找终端"三步砍成一步。

降级路径（Q1 决议）：命中失败时仍开新 terminal，并弹一次性 toast 告知"没找到现有 claude 终端"——保持现有能力不丢、用户知情。

挑选策略（Q2 决议）：多个 terminal 命中同 PID 时，按 `cwd` 匹配度打分（精确匹配 = 2，PID 命中但 cwd 不匹配 = 1），取最高分；并列时第一个。

## Background

| # | 事实 | 出处 |
|---|------|------|
| F1 | 当前 `openClaudeTerminal` 一律 `vscode.window.createTerminal({cwd})` + `show()`，不带 PID 查找 | `src/extension.ts:467-470` |
| F2 | 唯一调用点是右键菜单 `claudeTaskMonitor.openInTerminal`（group `2_open@1`），Command Palette 同名命令走同一函数 | `src/extension.ts:248-252`, `package.json:85, 163-166` |
| F3 | `SessionState.pid` 是 **claude CLI 进程 PID**（不是 shell PID），由 hook.sh 沿 PPID 链向上找到 `comm=claude` 的那个 | `src/types.ts:34`, `resources/hook.sh:43-54` |
| F4 | PID 跨平台分支已有现成经验：Linux `/proc`, macOS `ps -o comm=,ppid=`, Windows 不适用（CLI 跑在 WSL2） | `resources/hook.sh:24-41`, `.trellis/spec/liveness.md` |
| F5 | `vscode.window.terminals: readonly Terminal[]`，每个 terminal 有 `processId: Thenable<number \| undefined>` —— 是 shell 进程的 PID（bash/zsh/pwsh） | VS Code API（engines `^1.86.0`，满足） |
| F6 | VS Code API **无法**聚焦外部终端（iTerm/Terminal.app/Windows Terminal）—— README 已知局限的固有边界 | `README.md:121` |
| F7 | PID walking 的测试范式已有：`src/test/hook.test.ts` 用真子进程 + 改 `/proc/self/comm` 注入 comm 来模拟 claude 祖先 | `src/test/hook.test.ts:14-79` |
| F8 | Liveness 模块已经做了平台路由 + `isProcessGone`，**不复用**（liveness 判定死/活，我们要的是查 comm/ppid；职责不同） | `src/liveness.ts`, `.trellis/spec/liveness.md` |
| F9 | Q3 决议：**不**抽 hook.sh 的 PID walking 为共享代码，两份等价实现各自维护（避免 bash↔Node spawn 复杂度） | — |

## Algorithm Sketch

```
focusClaudeTerminal(s):
  for term in vscode.window.terminals:
    shellPid = await term.processId     // undefined → skip
    if not shellPid: continue
    ancestor = walkUpToComm(shellPid, 'claude')   // 沿 PPID 向上
    if ancestor === s.pid:
      score = (term.cwd === s.cwd) ? 2 : 1
      candidates.push({term, score})
  best = max(score) of candidates (or null)
  if best: best.term.show(); return
  fallback: createTerminal + show + toast
```

## Requirements

- R1. 在集成终端里跑 claude 时，右键 / 命令面板「在终端中打开」必须**聚焦那个终端 tab**，不新开
- R2. 命中后无打断（不弹 toast）
- R3. 未命中（外部终端 / 跨窗口 / terminal 已关 / `s.pid` 未捕获）→ 开新 terminal + 弹一次性 toast 告知
- R4. 多 terminal 同时命中同 PID 时，按 cwd 匹配度排序取最高分；并列取第一个
- R5. 跨平台：Linux / macOS / WSL2 (Windows) 任一能跑 Claude Code CLI 的环境都要工作；Windows host 跑原生 CLI 直接降级到 fallback
- R6. PID walking 整体 ≤1s（`processId` 单点 200ms timeout；`walkUpToComm` 单 fork 300ms + 8 层上限）
- R7. 错误（`processId` undefined / `walkUpToComm` 抛错 / 平台不支持）→ silent 走 fallback，不抛给 UI

## Acceptance Criteria

- [ ] **AC1 (集成终端主路径)**：用户在 VS Code 集成终端跑 `claude` → sidebar 出现该 session → 点 "Open in Terminal" → **不新开 terminal，原 tab 出现在前台**
- [ ] **AC2 (混合 cwd 场景)**：当前窗口有 A、B 两个终端，A 跑的项目 cwd 不同、B 跑 claude；点 A 项目的 session 行 → 焦点切到 B，**不新开 A 项目 cwd 的 terminal**
- [ ] **AC3 (Fallback — 外部终端)**：用户从外部终端（iTerm）跑 claude，VS Code 无匹配 terminal → 新开 terminal + 弹 toast "未找到正在运行该 claude 进程的集成终端"
- [ ] **AC4 (Fallback — 跨窗口)**：用户在两个 VS Code 窗口，A 跑 claude，B 看 sidebar → B 里点 "Open in Terminal" → 走 fallback（VS Code API 看不到 A 窗口的 terminal，B 一定无命中）
- [ ] **AC5 (Fallback — 无 pid)**：SessionState 没 pid 字段（hook.sh fallback 走 `$PPID`，或新装扩展还没数据）→ 走 fallback
- [ ] **AC6 (跨平台)**：在 macOS / WSL2 / Linux 任一环境，PID walking 能正确从 shell PID 走到 claude PID；Windows host 跑原生 CLI 走 fallback
- [ ] **AC7 (超时保护)**：单个 terminal 的 processId 取值 >200ms / 单次 `walkUpToComm` >300ms → 中止，整体不卡 UI
- [ ] **AC8 (回归)**：现有 `pnpm vitest run` 全绿；新增 `src/util/pidAncestor.test.ts` + `src/util/findClaudeTerminal.test.ts` 覆盖：命中、未命中降级、`pid=undefined`、`processId=undefined`、多命中 cwd 排序、并发超时

## Out of Scope

- ❌ 聚焦**外部**终端（iTerm.app / Terminal.app / Windows Terminal）—— VS Code API 无法控制；README 已知局限的固有边界
- ❌ 自动把外部 claude 终端的 PID 写进 `SessionState`（需要外部终端的 hook 体系，超出扩展能力）
- ❌ 改变 hook.sh 行为 / 引入新的 `SessionStart` 字段（已有 PID 已够用）
- ❌ UI 上的"在新窗口打开 terminal"按钮 / Tab 重命名 / 单击自动聚焦 等附属功能
- ❌ 抽 hook.sh 的 PID walking 到共享代码（Q3 决议：维护两份等价实现）
- ❌ 新增配置项（Q1=B 决议：固定行为，不走 D 配置项方案）

## Technical Notes

- **T1**. `walkUpToComm` Node 端在 `src/util/pidAncestor.ts`；最大深度 8（经验值:shell→node→claude 深度≤4），单 fork 300ms timeout
- **T2**. macOS `ps -o comm=` 会截断到 16 字符 —— hook.sh 已有 `tr -d ' '` 处理；Node 端 `.replace(/\s+$/, '')` 复刻
- **T3**. `term.processId` 是 `Thenable` —— 并发取所有 terminal 的 processId，单点 200ms race timeout
- **T4**. PID walking 频率低（仅用户点击触发），不需要缓存
- **T5**. cwd 比较前不做路径归一化（不解析 `/private/tmp` ↔ `/tmp` 这类 macOS 软链）—— 严格相等更可预测；用户点匹配错的 terminal 时重开就好
- **T6**. 新增 i18n key：`toast.terminal.notFound`（zh + en 各 1 条）

## Risks

- **R1**. 集成终端的 `processId` 在某些 terminal 类型（如 `extension` 类型，非 shell）会是 undefined —— 必须 silent skip，不要整个抛错
- **R2**. PID walking 走的是真 fork `ps`，click 频次虽低但若用户狂点会造成 `ps` 风暴 —— 1s 整体超时 wrapper 兜底
- **R3**. macOS 上 `ps -o comm=` 会截断到 16 字符 —— `claude` 4 字符不受影响但仍 `.trim()`，跟 hook.sh 一致
- **R4**. WSL2 host + WSL2 remote 的 PID 空间不同 —— 跨 PID namespace 本期不支持，列入 README 已知局限（已存在）
- **R5**. macOS / Linux 上 `claude` 进程如果是符号链接 / 不同 binary name（未来若改名为 `claude-code`）会失效 —— 单元测试用 `setSelfComm('claude')` 验证当前实现，未来改名是协调变更
