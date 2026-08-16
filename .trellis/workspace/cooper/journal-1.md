# Journal - cooper (Part 1)

> AI development session journal
> Started: 2026-08-16

---



## Session 1: 提炼 CTM 开发经验为 VSCode 扩展 SOP

**Date**: 2026-08-16
**Task**: 提炼 CTM 开发经验为 VSCode 扩展 SOP
**Branch**: `main`

### Summary

基于 Claude Task Monitor v0.1.4 仓库的实战经验整理成 VSCode 扩展开发 SOP 文档,落到仓库根 VSCODE-EXT-DEV.md,作为后续开发其他 VSCode 扩展的参考。同时清理遗留的 00-bootstrap-guidelines 任务(项目非前端,N/A)。

### Main Changes

- 新增 VSCODE-EXT-DEV.md(924 行):6 大章节(选型/项目结构/开发/测试/Open VSX 发布/GitHub Release 发布/工具栈)+ 3 附录(最小骨架/GitHub Actions/决策树) + 11 条踩坑
- 归档 00-bootstrap-guidelines 任务:本仓库是 VSCode 扩展后端,无前端范畴,该 bootstrap 任务由 trellis init 误生成
- 归档 08-16-vscode-extension-dev-doc 任务:已 commit 4ddc5b6,验收清单 8 条全打勾

### Git Commits

| Hash | Message |
|------|---------|
| `4ddc5b6` | (see git log) |

### Testing

- [OK] PRD 8 条验收标准全部勾选通过(文档位置、章节齐全、命令可复现、Open VSX 命名空间认领、工具栈分类、踩坑≥3、不含业务专属、最小骨架清单)

### Status

[OK] **Completed**

### Next Steps

- 后续开新扩展时直接复制 VSCODE-EXT-DEV.md 结构,按附录 A 的最小骨架起项目


## Session 2: 0.1.5 → 0.1.9: UX 三件套 + /code-review 修复 + 右键菜单 + Open VSX 发布

**Date**: 2026-08-16
**Task**: 0.1.5 → 0.1.9: UX 三件套 + /code-review 修复 + 右键菜单 + Open VSX 发布
**Branch**: `main`

### Summary

本会话完成 Claude Task Monitor 0.1.5 → 0.1.9 五个版本的端到端发版:
- 0.1.5: UX 三件套 (waiting 行余光可读 + 首次激活 onboarding + status bar + 通知聚合 + sidebar 徽标)
- 0.1.6: /code-review HIGH 修复 (jq gating + Windows 路径 basename + 死参数 + duplicate basename)
- 0.1.7: 内部清理 (SessionStore.offChange + applyBadge dedup + installHookAssets 幂等写)
- 0.1.8: sidebar 右键菜单 (5 个 action)
- 0.1.9: package.json description 更新 + 发布到 Open VSX (待用户激活)

技术亮点:
- 抽出 renderRowPresentation 纯函数便于测试 (elapsedSec caller-computed, 删 nowSec)
- 统一 node:path.posix.basename 处理 Windows \ + POSIX / 跨平台路径
- jq 检测失败时跳过 hook 安装,避免误导性 success toast
- waiting-count 闭包去重,避免每个 hook 事件无差别重渲染 UI
- SessionStore.offChange + treeDataProvider.dispose 配套,listener 可释放
- installHookAssets JSON 字符串对比,内容相同则跳过 writeFileSync

测试: 119 → 142 cases (+23, 含 Windows \ 路径 + aggregate + dedup + offChange)

未做的 backlog 项:
- VS Code Marketplace 发布 (用户决定优先 Open VSX,Marketplace 留 backlog)
- 一键批准 (技术边界 + 安全权衡,留 backlog)
- Marketplace CI 自动发布 (独立 backlog)

### Git Commits

| Hash | Message |
|------|---------|
| `4580916` | (see git log) |

### Status

[OK] **Completed**
