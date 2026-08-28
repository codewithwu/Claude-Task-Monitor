# C3 — Create GitHub release v0.3.4

## Goal

在 `codewithwu/Claude-Task-Monitor` 创建 GitHub release `v0.3.4`,asset 挂上
`codewithwu-cn.claude-task-monitor-0.3.4.vsix`,body 用 CHANGELOG.md 里
`[0.3.4]` 段的摘要。

## Pre-conditions

- C1 已经完成:`packages/codewithwu-cn.claude-task-monitor-0.3.4.vsix` 存在。
- C2 可以晚于 C3 完成 / 并行进行(两者互不依赖);建议顺序 C1 → C3 → C2,
  这样 GitHub release 链接可以提前贴给用户。
- `gh` CLI 2.45.0 已登录,token scope 包含 `repo`(`gh auth status` 已确认)。

## Functional Requirements

### FR1 — Create release with gh CLI

- 命令:
  ```
  gh release create v0.3.4 \
    packages/codewithwu-cn.claude-task-monitor-0.3.4.vsix \
    --title "v0.3.4" \
    --notes "<notes body>"
  ```
- `--notes` 来自 CHANGELOG.md 的 `[0.3.4]` 段(FR3)。
- tag `v0.3.4` 在 C1 已经 push,所以 gh 不会新建 tag(C1 tag 用 annotated,
  gh release create 会优先复用已有 tag)。
- 不要带 `--draft`(本 release 是 final)。
- 不要带 `--prerelease`(patch bump 不是 prerelease)。

### FR2 — Verify release

- `gh release view v0.3.4 --json tagName,title,assets,body`:
  - `tagName` = `v0.3.4`
  - `title` = `v0.3.4`
  - `assets` 里包含 `codewithwu-cn.claude-task-monitor-0.3.4.vsix`,
    `size` > 100 KB
  - `body` 包含 CHANGELOG 摘要的关键字("formatErrorMessage" 或
    "LangToggle" 或 "round-4")
- 也可以 `gh release view v0.3.4` 直接看渲染版。

### FR3 — Notes body

- 来源:`CHANGELOG.md` 的 `## [0.3.4] - 2026-08-28` 段,**完整照抄**,包括
  `### Fixed` / `### Testing` 子段。
- 头一行不写 `## [0.3.4] - 2026-08-28`(gh release 标题已经给出,避免重复)。
- 用 `--notes-file <tmpfile>` 而不是 `--notes "<long string>"`,避免 shell
  quoting 噩梦。tmpfile 路径:`/tmp/gh-release-notes-0.3.4.md`,发布完
  删掉。

## Non-functional Requirements

- **NFR1**:GitHub release URL 不带 token,不要 log 包含 token 的链接。
- **NFR2**:tmpfile `/tmp/gh-release-notes-0.3.4.md` 任务结束删除。
- **NFR3**:不修改 `CHANGELOG.md` / `package.json`(C1 已经写好)。
- **NFR4**:不动其他 release(0.3.0 / 0.3.1 / 0.3.2 / 0.3.3)。

## Acceptance Criteria

- [ ] **AC1**:`gh release view v0.3.4 --json tagName,title` 输出
  `{ "tagName": "v0.3.4", "title": "v0.3.4" }`。
- [ ] **AC2**:`gh release view v0.3.4 --json assets` 包含
  `codewithwu-cn.claude-task-monitor-0.3.4.vsix`,`size` > 100 KB。
- [ ] **AC3**:`gh release view v0.3.4 --json body` body 包含
  "formatErrorMessage" / "LangToggle" / "round-4" 关键字(任一即可,
  证明是 [0.3.4] 段摘要而不是 0.3.3 的内容)。
- [ ] **AC4**:`gh release view v0.3.4 --json url` 给出的 URL 在浏览器打开
  能看到 release(asset 可下载)。
- [ ] **AC5**:tmpfile `/tmp/gh-release-notes-0.3.4.md` 在任务结束时已删除。

## Out of Scope

- 触发 `actions/upload-release-asset` 等 CI hook(本仓库无 release CI)。
- 给 release 加 `latest` flag(GitHub 默认会把最新 semver 标 latest,
  gh release create 不需要手动加)。
- 发布 draft / prerelease。
- 在 README / docs 里更新版本号 / 链接(超出本次发布范围)。

## Rollback

- `gh release delete v0.3.4 --yes`:删除整个 release(包括 tag)。
- 已上传 asset 也会一并被删。
- 如果 tag 已经被 `git push` 推到 origin,删 release 之后还要
  `git push origin :v0.3.4` 删 remote tag;但 C1 已经做了 tag push,
  这是正常的副作用。
- 本地 tag `git tag -d v0.3.4` 删掉。
- 不会影响 Open VSX 已经发布的 0.3.4(那是 C2 的产物)。