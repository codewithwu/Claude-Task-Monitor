# Release v0.3.2: package + Open VSX + GitHub

## Goal

Ship commit `793bcfe fix(i18n): address 5 code-review findings in lang pipeline` as **v0.3.2** to Open VSX (Eclipse Open VSX Registry) and create the matching GitHub release. Patch bump because the commit is a fix, not a feature.

## Origin (pain point)

Three-step release that's easy to half-do. Past releases (v0.3.0 / v0.3.1) followed the same pattern: bump version → `pnpm package` → record CHANGELOG commit. New this time is Open VSX publishing — namespace `codewithwu-cn.claude-task-monitor` was first registered for v0.3.1, the Open VSX `ovsx` CLI is already on PATH, and `OVSX_PAT` is set in env.

## Functional Requirements

### FR1 — Version bump to 0.3.2 in `package.json`
- Field `"version": "0.3.1"` → `"version": "0.3.2"`.
- Field `"displayName"` and `"description"` left alone (no `--no-update-package-json` flag needed; `pnpm package` reads version from `package.json` directly).

### FR2 — CHANGELOG entry under `[0.3.2]` dated 2026-08-25
- Add `## [0.3.2] - 2026-08-25` section after `[Unreleased]`, before `[0.3.1]`.
- `### Fixed` block summarizing the 5 code-review fixes (see commit `793bcfe`).
- Add `[0.3.2]` link reference at the bottom following the existing `[Unreleased]: https://github.com/codewithwu/Claude-Task-Monitor/compare/v0.3.1...HEAD` style.
- Move the `[Unreleased]` compare target from `v0.3.1...HEAD` to `v0.3.2...HEAD` (open-ended → next release base).

### FR3 — Build `.vsix` artifact
- `pnpm package` (script: `vsce package --no-dependencies && mkdir -p packages && mv *.vsix packages/`).
- Output: `packages/codewithwu-cn.claude-task-monitor-0.3.2.vsix`.
- Verify file exists and size is sane (>100 KB).

### FR4 — Publish to Open VSX
- `ovsx publish packages/codewithwu-cn.claude-task-monitor-0.3.2.vsix --pat "$OVSX_PAT"` (or rely on `OVSX_PAT` env directly).
- Verify with `ovsx get codewithwu-cn.claude-task-monitor` returning v0.3.2.
- Fail-safe: do NOT mark this step complete unless `ovsx get` confirms 0.3.2.

### FR5 — GitHub release
- `gh release create v0.3.2 packages/codewithwu-cn.claude-task-monitor-0.3.2.vsix --title "v0.3.2" --notes "<CHANGELOG excerpt>"`.
- Title: `v0.3.2` (matches v0.3.0 / v0.3.1 pattern).
- Notes: the new `[0.3.2]` section verbatim from CHANGELOG.md (extracted via `awk` / sed).
- Tag created automatically (gh release creates tag if missing).

### FR6 — Version-bump commit
- One commit `chore: bump version 0.3.1 → 0.3.2 + CHANGELOG` touching only `package.json` + `CHANGELOG.md`. Matches the prior `4cc58a2` and `80d44e6` commit messages.

## Non-functional Requirements

### NFR1 — No code change in this task
- Only `package.json`, `CHANGELOG.md`, and `packages/` (build artifact) are touched.
- `src/` is read-only in this session.

### NFR2 — Secrets handling
- `OVSX_PAT` env var length verified at session start (43 chars) but value never printed/logged.
- `gh` token auto-masked by gh CLI.
- No secrets in commit messages, release notes, or chat output.

### NFR3 — Idempotency / rollback
- `git revert <version-bump-commit>` recovers package.json + CHANGELOG.
- `gh release delete v0.3.2` + `git tag -d v0.3.2 && git push origin :v0.3.2` removes GitHub release.
- Open VSX has no rollback API for published versions — must publish-yank via new version if needed (publisher discretion; out of scope for this task).

### NFR4 — No `.github/workflows` change
- Repo has no release CI. Release is fully manual + local + on main. Don't introduce one.

## Acceptance Criteria

- [ ] **AC1**: `git show HEAD:package.json | grep version` shows `"version": "0.3.2"`.
- [ ] **AC2**: `CHANGELOG.md` has a `## [0.3.2] - 2026-08-25` section above `[0.3.1]`, and `[Unreleased]` compare target updated to `v0.3.2...HEAD`.
- [ ] **AC3**: `packages/codewithwu-cn.claude-task-monitor-0.3.2.vsix` exists with size > 100 KB.
- [ ] **AC4**: `ovsx get codewithwu-cn.claude-task-monitor` returns v0.3.2 as the latest version.
- [ ] **AC5**: `gh release view v0.3.2` shows title `v0.3.2`, asset `codewithwu-cn.claude-task-monitor-0.3.2.vsix`, and the CHANGELOG excerpt in body.
- [ ] **AC6**: Commit `chore: bump version 0.3.1 → 0.3.2 + CHANGELOG` is on main, ahead of `793bcfe`.
- [ ] **AC7**: `pnpm test` still passes (no src/ changes; sanity check).

## Out of Scope

- Publishing to VS Code marketplace (`vsce publish`) — out of scope; user only asked for Open VSX.
- Bumping `displayName` / `description` / `package.nls.*` — no copy changes.
- A new CHANGELOG entry for the `08-25-fix-i18n-lang-bugs` Trellis task archive (that's task metadata, not a release).
- Reverting or unpublishing existing v0.3.1 — release goes forward, not backward.

## Risks

- **R1**: Open VSX publish is irreversible per version. If 0.3.2 has a packaging bug, must publish 0.3.3 with the fix. Mitigation: dry-run check via `vsce ls-publishers` / `ovsx verify` (if available) before publishing.
- **R2**: GitHub release URL requires `gh` to have `repo` scope. `gh auth status` at session start confirmed active account `codewithwu`, but doesn't prove scope. If push fails, user must re-auth with `gh auth refresh -s repo`.
- **R3**: Network reliability to open-vsx.org from CN may need VPN (user note: uses VPN; dev.azure.com redirects to zh-cn page without it). Mitigation: if `ovsx publish` times out, retry; if persistent failure, ship .vsix via GitHub release only and report Open VSX status as pending.
- **R4**: `pnpm package` script moves `*.vsix` into `packages/`. If a stale `codewithwu-cn.claude-task-monitor-0.3.1.vsix` is left at repo root from a prior `ovsx get`, it stays there. Mitigation: confirm `packages/` is the only build artifact dir after the task.