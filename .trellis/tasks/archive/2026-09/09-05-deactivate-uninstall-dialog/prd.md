# P0 #2 — 关窗口就弹「移除 hook」对话框

> 来源:`notes/improvement-backlog.md` 第 21 行(基线 v0.3.5 / commit `5df5303`)。
> 排序:止血项,#1 之后的第二优先级。

## 1. 背景与现状

`src/extension.ts:521` 的 `deactivate()` 会无条件 `vscode.window.showInformationMessage`
询问用户是否移除 `~/.claude/settings.json` 中的 hooks 块与 `~/.claude-task-monitor/hook.sh`。

### 现状问题

VS Code 的 `deactivate()` 在以下**所有**场景都会触发:

| 触发场景 | 期望行为 | 实际行为 |
|---|---|---|
| 窗口 reload | 静默资源释放 | 弹对话框 ✗ |
| 关闭窗口(不卸载扩展) | 静默资源释放 | 弹对话框 ✗ |
| 禁用扩展 | 静默资源释放 | 弹对话框 ✗ |
| 卸载扩展 | 应执行清理 | 弹对话框(但卸载流程已经发生,清理被 `void .then()` 异步丢包,可能根本跑不到) |

净效果:对日常用户而言是**纯噪音 + 误删风险**;对真正卸载的用户,清理反而可能丢。

## 2. 目标

- 任何 `deactivate()` 路径(reload / 关窗 / 禁用)不再弹任何对话框。
- 卸载扩展时,**可靠**清理 `~/.claude/settings.json` 中本扩展的 hooks 条目 + `~/.claude-task-monitor/hook.sh`。
- 不影响卸载之外的任何现有行为。

## 3. 非目标

- 不改 hook 安装/合并逻辑(`installHookAssets` / `mergeSettings`)— 那一路没问题。
- 不动其他 P0/P1 项(#1 macOS liveness / #4-5 跳转 / 决策面板等)。
- 不引入新依赖。

## 4. 约束

- 扩展运行环境与卸载脚本运行环境**不同**:
  - `deactivate()` 在 Extension Host 里跑,有 `vscode` API。
  - 卸载钩子在普通 Node.js 进程里跑(无 `vscode` API),只能用 `fs` / `path` / `os`。
- VS Code `vscode:uninstall` 是唯一能区分「卸载」与「deactivate」的官方机制(v1.21+, Feb 2018)。
- 必须保留现有 `uninstallSettings(existing)` 的语义(只移除 `_owner === OWNER_TAG` 的条目,不动用户原有 hooks)。

## 5. 验收标准

| # | 验收项 | 验证手段 |
|---|---|---|
| AC1 | 扩展被 Reload Window / 关窗 / 禁用时,不弹任何对话框 | 手动 + 单元/集成测试覆盖 `deactivate()` 路径 |
| AC2 | `code --uninstall-extension codewithwu-cn.claude-task-monitor` 完成后,`~/.claude/settings.json` 中本扩展的 7 个 hook 事件条目全部消失 | 手工验证 + 卸载脚本单测 |
| AC3 | 卸载时若用户 `~/.claude/settings.json` 还有非本扩展的 hooks,**完整保留** | 单测:seed 混合 hooks,运行 uninstall,断言非本扩展条目不变 |
| AC4 | 卸载时 `~/.claude-task-monitor/hook.sh` 被删除 | 单测:在 tmpDir 创建 hook.sh,运行 uninstall,断言文件不存在 |
| AC5 | 卸载脚本兼容 Linux / macOS / Windows(纯 Node `fs` + `path.join`,不依赖 shell) | CI 在 linux 上跑;Windows 由后续 #11 处理,本任务仅保证代码层不绑 shell |
| AC6 | `pnpm test` 全部通过,新增 ≥3 个 `uninstall` 单测 | `pnpm test` 退出码 0 |
| AC7 | `pnpm build` 通过,`dist/` 中含 `uninstall.js` | `ls dist/uninstall.js` |
| AC8 | `deactivate()` 不再引用 `uninstallSettings` / `HOOK_SCRIPT` / `CLAUDE_SETTINGS` 的删除路径 | `grep` 验证 |

## 6. 风险与回滚

- **风险 1**:卸载钩子在某些 VS Code 版本可能不触发(老版本 <1.21)。
  - **缓解**:`engines.vscode` 已声明 `^1.86.0`,完全覆盖。
- **风险 2**:卸载脚本里 `fs.readFileSync` settings.json 抛异常(用户已手动删除)。
  - **缓解**:`try/catch` 包裹 + 静默 `console.warn`,与现有 deactivate 路径行为一致。
- **回滚**:把 `deactivate()` 的卸载逻辑粘回去,`vscode:uninstall` 留空即可。

## 7. 范围外但相关

- 用户手动卸载后想恢复 hooks:不在本任务范围,卸载前的提示可在 #11(干掉 jq + 跨平台重构)一并优化。
- `deactivate()` 内部仍需 `leaderLock.stop()` / `watcher.close()` 等资源释放,本任务保留这些,不删。
