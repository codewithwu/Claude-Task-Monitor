# Release v0.3.5 (audit-r5 fixes)

## Goal

把 round-5 src/ audit 产出的 3 个 fix commit (`9ae6ae1` + `ce29ef7` + `a6cb01f`)
打包成 `v0.3.5` 发布:`CHANGELOG` 段、`package.json` version bump、`.vsix`
构建、push commit + tag `v0.3.5` 到 origin、Open VSX publish、GitHub release。

## Scope

包含自 `v0.3.4` (commit `0a2d6fc`) 以来、到当前 `main` HEAD
(`31380f0 chore(task): archive 08-29-audit-fixes-r5`) 的 3 个 src/ 改动
commit + 1 个 spec doc commit:

| Commit     | Type | Summary                                                     |
| ---------- | ---- | ----------------------------------------------------------- |
| `9ae6ae1`  | fix  | audit-r5: 3 core bugs (formatError / watcher / tooltip)      |
| `ce29ef7`  | fix  | i18n: 3 hardcoded Chinese strings                           |
| `a6cb01f`  | docs | spec: truncation recovery + MarkdownString appendText 边界 |

`31380f0 chore(task): archive 08-29-audit-fixes-r5` 不进 release
内容(纯 task archive,无 src/spec 影响)。

## Subtask Map

| Subtask                              | Responsibility                                              |
| ------------------------------------ | ----------------------------------------------------------- |
| `08-29-bump-and-build-0.3.5`         | CHANGELOG、version bump、build .vsix、commit + tag + push    |
| `08-29-publish-openvsx-0.3.5`        | `ovsx publish` 到 Eclipse Open VSX Registry                 |
| `08-29-github-release-0.3.5`         | GitHub release 页面 + release notes                         |

## Cross-Child Acceptance Criteria

- [ ] **CC-AC1**:`git tag --list | grep '^v0.3.5$'` 在 origin 命中。
- [ ] **CC-AC2**:`ovsx get codewithwu-cn.claude-task-monitor` 输出里
  `version` 字段 = `0.3.5`。
- [ ] **CC-AC3**:GitHub release `v0.3.5` 在
  `github.com/codewithwu/Claude-Task-Monitor/releases/tag/v0.3.5`
  可访问,带 `.vsix` attachment。
- [ ] **CC-AC4**:三个子任务全部 `archived/2026-08/` 下,各带 prd +
  task.json。

## Non-functional Requirements

- **NFR1**:`OVSX_PAT` / GitHub token 不进 commit message / log / chat 输出。
- **NFR2**:`packages/*.vsix` 由 `.gitignore` 排除,commit 里不会出现。
- **NFR3**:三个子任务顺序执行,任一失败 → 后续子任务不开始,留 TODO。

## Out of Scope

- `vsce publish` 到 VS Code marketplace。
- 改 `displayName` / `description` / `package.nls.*`。
- 删任何 fix 分支(本版本无 fix 分支合并,全部在 main 上)。

## Rollback

- 子任务未推进:rollback 由对应子任务的 PRD 决定。
- tag push 后需要撤回:`git push origin :v0.3.5` + `git tag -d v0.3.5`。
- Open VSX publish 是不可撤回的(immutable registry);revert 必须走
  publish 新 patch 版本。
- GitHub release 可手动 delete + re-create。
