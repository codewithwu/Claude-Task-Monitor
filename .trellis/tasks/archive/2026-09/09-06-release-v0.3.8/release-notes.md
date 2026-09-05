## v0.3.8 — sidebar focuses the running Claude terminal

Sidebar「在终端中打开」从「新开一个相同 cwd 的 terminal」改为「聚焦那个已经在跑 claude 的集成终端 tab」。命中失败时按 PRD Q1=B 决议 fallback:开新 terminal + 弹一次性 toast 告知。

### Added (commit `e06da35`, task `09-06-jump-to-that-terminal`)

- **Sidebar 聚焦正在跑 Claude 的集成终端**:点 sidebar「在终端中打开」时,默认聚焦那个已经跑 claude 的集成终端 tab,不新开。
  命中失败时按 PRD Q1=B 决议 fallback:开新 terminal + 弹一次性 toast 告知。
  新增 `src/util/pidAncestor.ts`(跨平台 `walkUpToComm`,Linux 走 `/proc`,Darwin 走 `ps`,win32 返 null)+ `src/util/findClaudeTerminal.ts`(遍历 `vscode.window.terminals`,并发取 `processId` + 200ms race + cwd 评分(精确=2,PID 命中但 cwd 不匹配=1))。
  `extension.ts:467` `openClaudeTerminal` 改写为先 `findClaudeTerminal` 再 fallback,公开签名保持 sync,内部 `void openClaudeTerminalAsync(s)` 转发避免改动 `registerCommand` callback 签名。
  新增 26 个单元测试覆盖跨平台分支 / 命中 / cwd 排序 / 超时 / undefined short-circuit(`pidAncestor.test.ts` 15 + `findClaudeTerminal.test.ts` 11)。
  `README.md`「已知局限」第二条精确化:VS Code 只能聚焦本窗口内的集成终端,外部终端(iTerm/Terminal.app/Windows Terminal)/ 跨窗口仍只能开项目。closes improvement-backlog #4 (P1)。

### Docs

- `spec/liveness.md` 文档化三模块 PID 架构(commit `6569479`):`hook.sh` 抓 PID / `pidAncestor.ts` 沿 PPID 链上溯 / `liveness.ts` 判死活,职责清晰分离。

### Install / Upgrade

- VS Code Marketplace: 升级提示会推 0.3.8(extension id `codewithwu-cn.claude-task-monitor`)
- Open VSX: <https://open-vsx.org/extension/codewithwu-cn/claude-task-monitor> 已经更新到 0.3.8

### Full Changelog

Compare: <https://github.com/codewithwu/Claude-Task-Monitor/compare/v0.3.7...v0.3.8>
CHANGELOG: <https://github.com/codewithwu/Claude-Task-Monitor/blob/v0.3.8/CHANGELOG.md>
