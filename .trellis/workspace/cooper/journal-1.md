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
