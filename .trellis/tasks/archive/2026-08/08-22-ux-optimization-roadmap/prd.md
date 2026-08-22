# UX 优化路线图 (P0/P1/P2 共 18 项)

## Goal

把上轮 UX 审计的 18 项改进拆成 10 个可独立验收的子任务;父任务负责跨子验收 + 优先级排序,子任务按 P0 → P2 顺序排期。目标是把插件从"能用"做到"上手即懂,专业用户也顺手"。

## Background: 18 项审计清单

| 编号 | 来源文件 | 描述 | 归属子任务 |
|---|---|---|---|
| P0-1 | `treeDataProvider.ts:37-41` | 单击 Session 行 = 直接替换当前 workspace | `ux-single-click-fix` |
| P0-2 | `treeDataProvider.ts:46-48` | Session 列表无分组/过滤 | `ux-grouping-filter` |
| P0-3 | `ui/onboarding.ts:24-50` | Onboarding 一次性,跳过无重入入口 | `ux-onboarding-rerunnable` |
| P0-4 | `extension.ts:43-51` | jq 缺失只 toast 一闪而过,sidebar 仍空 | `ux-onboarding-rerunnable` |
| P1-5 | `package.json:143-148` | 无静音模式,深度 focus 时被打扰 | `ux-notification-modes` |
| P1-6 | `notifier.ts`(dedupe key) | dedupe 按 sessionId 太激进,连续 tool 只弹第一条 | `ux-notification-modes` |
| P1-7 | `util/rowPresentation.ts:42-51` | 三状态图标仅换色,色盲不可分 | `ux-status-icons-shape` |
| P1-8 | `util/rowPresentation.ts:29` | 长等阈值硬编码 300s | `ux-ui-polish` |
| P1-9 | `ui/statusBar.ts` + `statusBarContent.ts` | status bar 信息密度低 | `ux-ui-polish` |
| P1-10 | `package.json:38-40` | activitybar 二态缺失 | `ux-ui-polish` |
| P2-11 | `package.json`(缺 keybindings) | 无快捷键 focus sidebar | `ux-shortcuts-contextmenu` |
| P2-12 | `package.json:91-118` | 右键菜单缺 Open in New Window 等 | `ux-shortcuts-contextmenu` |
| P2-13 | `package.json:65-89` | Command Palette 命令带参不可用 | `ux-shortcuts-contextmenu` |
| P2-14 | `package.json`(缺 settings 入口) | 配置无 UI 入口 | `ux-config-welcome-entries` |
| P2-15 | `package.json` + UI 文案 | 中英混搭,影响全球上架 | `ux-i18n` |
| P2-16 | `package.json:55-57` | Welcome View 陈述事实不引导 | `ux-config-welcome-entries` |
| P2-17 | `liveness.ts` | Ctrl+Z 后 5s 才移除,无视觉过渡 | `ux-advanced-experience` |
| P2-18 | (待实测) | 多窗口下通知路由可能错位 | `ux-advanced-experience` |

## Requirements

### 范围

- 覆盖审计清单全部 18 项(每项归属已映射)
- 10 个子任务各自可独立 plan / implement / archive
- 跨子任务不破坏既有功能(激活 / 卸载 / hook 注入 / 现有 142 用例)

### 跨子依赖

- `ux-status-icons-shape` 与 `ux-ui-polish` 共享 `longWaitingThresholdSec` 配置 → **必须同一 PR**
- `ux-shortcuts-contextmenu` 依赖 `ux-single-click-fix` 的"Open in New Window"作为 fallback
- `ux-config-welcome-entries` 依赖 `ux-onboarding-rerunnable` 的命令骨架
- 其余子任务相互独立

### 不做

- 重写 plugin 架构(仍基于 watcher + store + treeDataProvider 三层)
- 修改 hook.sh 内容(只动 `OWNER_TAG` 兼容层)
- 引入新依赖(状态栏 / 通知 / 树视图全用 vscode 内置 API)
- 改发布/打包流程

## Acceptance Criteria

### 跨子验收

- [ ] 18 项审计条目全部有对应子任务覆盖(已映射完成)
- [ ] 所有子任务完成并归档后,版本号 bump 到 **0.2.0**(新增可见功能)
- [ ] 既有 `pnpm test`(vitest) 142 用例全绿,不破
- [ ] `pnpm test:integration` 通过
- [ ] `~/.claude/settings.json` 中已有 hook 注入位置不变(OWNER_TAG 兼容)
- [ ] 不引入新运行时依赖(`package.json` `dependencies` 不变)
- [ ] 父任务最终 archive 时,10 个子任务全部 archived

### Phase 完成度

- [ ] **Phase A** (P0 三件)完成后归档: `ux-single-click-fix` / `ux-grouping-filter` / `ux-onboarding-rerunnable`
- [ ] **Phase B** (P1 三件)完成后归档: `ux-status-icons-shape` + `ux-ui-polish`(同 PR)/ `ux-notification-modes`
- [ ] **Phase C** (P2 四件)完成后归档: `ux-shortcuts-contextmenu` / `ux-config-welcome-entries` / `ux-advanced-experience` / `ux-i18n`

## Recommended Implementation Order

### Phase A — P0 三件(影响最严重,优先做)
1. `ux-single-click-fix` — 单击行为修复,hot spot 小,30 行改动
2. `ux-onboarding-rerunnable` — 命令骨架 + Welcome View 链接
3. `ux-grouping-filter` — TreeView 嵌套分组

### Phase B — P1 三件(互相联动)
4. `ux-status-icons-shape` + `ux-ui-polish` — 同 PR(共享 longWaitingThresholdSec)
5. `ux-notification-modes` — 独立,可与上一项并行

### Phase C — P2 四件(可选打磨)
6. `ux-shortcuts-contextmenu` — 依赖 A1 的 Open in New Window
7. `ux-config-welcome-entries` — 依赖 A2 的命令骨架
8. `ux-advanced-experience` — 独立;P2-18 多窗口通知需 design.md 实测
9. `ux-i18n` — 工作量最大,放最后;若超预算可推到下个 release

每个子任务启动前:`task.py start <slug>`,复杂任务先写 `design.md` + `implement.md`。

## Notes

- 父任务本身不直接产出代码,只负责路线 / 验收 / archive
- 各子任务 PRD 中已写明具体 hot spot 文件 / 行号 / 与其他任务的联动,无需在此重复
- 用户在 plan 阶段确认后,按 Phase A → B → C 顺序逐个 `task.py start` 即可
- 用户可在任何节点要求调整子任务边界或跳过 P2 项