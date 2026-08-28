# Release v0.3.4: round-4 i18n fixes + Open VSX + GitHub

## Goal

Ship commit `0a3dc0c fix(i18n): address 4 round-4 code-review findings` (and the matching
task-archive commit `4a5c81e`) as **v0.3.4** on main, publish to Open VSX (Eclipse
Open VSX Registry), and create the matching GitHub release. Patch bump because the
underlying commits are code-review fixes, not features.

## Origin (pain point)

- 用户走完 `/code-review @src/` 的 4 个 findings 之后,fix 在
  `fix/08-28-round4-i18n-review-fixes` 上,main 还停在 v0.3.3。
- 用户明确选择 "先合并到 main,再在 main 上发布",保持 main = 唯一可信源 /
  tag 都在 main 的历史一致性。
- 本次是 round-4 收尾:formatError duck-typing / LangToggle fail-soft /
  i18n.test warn leak / extension.deactivate() catch。详见
  `.trellis/tasks/archive/2026-08/08-28-code-review-round4-fixes/prd.md`。

## Source of truth

- 分支:`fix/08-28-round4-i18n-review-fixes`(在 main 之上 +2 commits:`0a3dc0c` + `4a5c81e`)
- main HEAD:`76b04ba chore: bump version 0.3.2 → 0.3.3 + CHANGELOG`(origin/main 同步)
- 发布后 main HEAD 应为 `chore: bump version 0.3.3 → 0.3.4 + CHANGELOG`
  (在 merge commit 之上)

## Deliverables (cross-child AC map)

| Child | Slug | 关键产出 |
|---|---|---|
| C1 | `bump-and-build-0.3.4` | main 分支上 `package.json` 是 `0.3.4`,CHANGELOG 有 `[0.3.4]`,`packages/codewithwu-cn.claude-task-monitor-0.3.4.vsix` 已构建,tag `v0.3.4` 已 push |
| C2 | `publish-openvsx-0.3.4` | `ovsx get codewithwu-cn.claude-task-monitor` 最新版 = `0.3.4` |
| C3 | `github-release-0.3.4` | `gh release view v0.3.4` 显示 title `v0.3.4`、asset `.vsix`、CHANGELOG 摘要在 body |

## Acceptance Criteria (overall)

- [ ] **AC-Parent-1**: `main` 分支上 `git show HEAD:package.json | grep version` = `"version": "0.3.4"`
- [ ] **AC-Parent-2**: `CHANGELOG.md` 有 `## [0.3.4] - 2026-08-28` 段,摘要在 `[0.3.3]` 之上
- [ ] **AC-Parent-3**: `packages/codewithwu-cn.claude-task-monitor-0.3.4.vsix` 存在,size > 100 KB
- [ ] **AC-Parent-4**: Open VSX 上 `codewithwu-cn.claude-task-monitor` 最新 = `0.3.4`
- [ ] **AC-Parent-5**: GitHub `v0.3.4` release 已建,asset + 标题 + 摘要都到位
- [ ] **AC-Parent-6**: tag `v0.3.4` 在 origin 上;`origin/main` HEAD 在 tag 之上
- [ ] **AC-Parent-7**: 三个子任务全部 archive 完毕,各自 PRD + check.jsonl 收尾

## Out of Scope

- 发布到 VS Code marketplace(`vsce publish`),用户只点名 Open VSX。
- `displayName` / `description` / `package.nls.*` 没有文案变更。
- 不引入 `.github/workflows/release.yml` 之类的 CI(沿用手动 + 本地 + main)。
- 不动 `fix/08-28-round4-i18n-review-fixes` 分支本身的 head;archive 提交已经在 head,
  release 完成后可以保留也可以删除(看子任务 C1 是否显式清理)。

## Risks

- **R1**: merge fix 分支到 main 时如果有 main 上后续的新 commit 冲突,需要解决
  (round 4 fixes 触及 `src/extension.ts` / `src/util/formatError.ts` /
  `src/ui/langToggle.ts` / `src/i18n/messages/*.ts` / 测试文件)。
  Mitigation:merge 前先 `git fetch origin main && git log origin/main..HEAD`,
  如果有冲突停下来让用户决策。
- **R2**: Open VSX publish 不可回滚;若 .vsix 有打包 bug 必须再发 0.3.5。
  Mitigation:`pnpm package` 跑完先 `vsce ls` 或 unzip 检查 manifest,确认
  `version` / `publisher` 字段正确再 publish。
- **R3**: 网络到 open-vsx.org 走 VPN(用户已知)。`ovsx publish` 失败就重试,
  持续失败则只发 GitHub release 并把 Open VSX 标 pending。
- **R4**: `gh` token scope 必须含 `repo`。session start 时 `gh auth status`
  显示 `read:org, repo`,已 OK。
- **R5**: `pnpm package` 把 `*.vsix` 移到 `packages/`。仓库根目录残留的
  `codewithwu-cn.claude-task-monitor-0.3.2.vsix`(从上次 `ovsx get`)不算本任务
  产物,不需要清掉。