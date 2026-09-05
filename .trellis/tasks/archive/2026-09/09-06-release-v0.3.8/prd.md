# Release v0.3.8 (focus-terminal P1)

## Goal

把 `e06da35 feat(sidebar): focus the terminal running Claude instead of opening a new one`(improvement-backlog #4 P1 完成)打包成 `v0.3.8` 发布:`CHANGELOG` 段、`package.json` version bump、`.vsix` 构建、push commit + tag `v0.3.8` 到 origin、Open VSX publish、GitHub release。

## Scope

包含自 `v0.3.7`(commit `4c72f92 chore(release): bump version to 0.3.7`)以来、到当前 `main` HEAD (`93287f7`) 的 2 个 user-facing 改动 commit:

| Commit     | Type | Summary                                                                                                  |
| ---------- | ---- | -------------------------------------------------------------------------------------------------------- |
| `e06da35`  | feat | sidebar: focus the terminal running Claude instead of opening a new one (improvement-backlog #4 P1)      |
| `6569479`  | docs | spec: document three-module PID architecture                                                              |

`93287f7 chore: record journal` + `e664a19 chore(task): archive 09-06-jump-to-that-terminal` 不进 release 内容(纯 task archive / journal,无 src/spec 影响)。

## Subtask Map

| Subtask                                | Responsibility                                                |
| -------------------------------------- | ------------------------------------------------------------- |
| `09-06-bump-and-build-0.3.8`           | CHANGELOG、version bump、build .vsix、commit + tag + push      |
| `09-06-publish-openvsx-0.3.8`          | `ovsx publish` 到 Eclipse Open VSX Registry                   |
| `09-06-github-release-0.3.8`           | GitHub release 页面 + release notes + .vsix attachment        |

## Cross-Child Acceptance Criteria

- [ ] **CC-AC1**:`git tag --list | grep '^v0.3.8$'` 在 origin 命中。
- [ ] **CC-AC2**:`ovsx get codewithwu-cn.claude-task-monitor --metadata` 输出里 `version` 字段 = `0.3.8` AND `versionAlias` 包含 `"latest"`。
- [ ] **CC-AC3**:GitHub release `v0.3.8` 在 `github.com/codewithwu/Claude-Task-Monitor/releases/tag/v0.3.8` 可访问,带 `.vsix` attachment。
- [ ] **CC-AC4**:四个任务(parent + 3 children)全部 archived 到 `archive/2026-09/`,各带 prd + task.json。
- [ ] **CC-AC5**:`CHANGELOG.md` 的 `[Unreleased]` 段已替换为 `[0.3.8] - 2026-09-06` 段,新 `[Unreleased]` 段为空。

## Non-functional Requirements

- **NFR1**:`OVSX_PAT` / GitHub token / 任何 PAT 不进 commit message / log / chat 输出。
- **NFR2**:`packages/*.vsix` 由 `.gitignore` 排除,commit 里不会出现。
- **NFR3**:三个子任务顺序执行,任一失败 → 后续子任务不开始,留 TODO。
- **NFR4**:CHANGELOG 沿用中文优先 + Keep a Changelog 格式;与 0.3.6 / 0.3.7 段同款。

## Out of Scope

- `vsce publish` 到 VS Code marketplace(不在本项目 scope)。
- 改 `displayName` / `description` / `package.nls.*`。
- 任何 src/ 改动——本版本纯 release。

## Rollback

- 子任务未推进:rollback 由对应子任务的 PRD 决定。
- tag push 后需要撤回:`git push origin :v0.3.8` + `git tag -d v0.3.8`。
- Open VSX publish 是不可撤回的(immutable registry);revert 必须走 publish 新 patch 版本。
- GitHub release 可手动 `gh release delete v0.3.8` + re-create。

## Notes

- Tag 命名历史沿用 `vX.Y.Z`(无前缀),与 `v0.3.3` ~ `v0.3.7` 一致。
- Open VSX publish 需要 `OVSX_PAT` env var;session start 已确认设置。`ovsx` CLI 在 `/home/cooper/.nvm/versions/node/v24.11.1/bin/ovsx`。
- GitHub release 用 `gh` CLI;`gh` 在 `/usr/bin/gh`,session 需 `gh auth status` 通过。
