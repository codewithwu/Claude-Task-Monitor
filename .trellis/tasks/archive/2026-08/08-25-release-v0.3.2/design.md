# Design — Release v0.3.2

## Overview

A linear 3-step pipeline with one commit framing them:

```
[commit 793bcfe, src/]
        ↓
[chore: bump version → CHANGELOG + package.json]   ← commit 1
        ↓
[pnpm package → packages/*.vsix]                   ← local build
        ↓
[ovsx publish → Open VSX]                          ← external
        ↓
[gh release create → GitHub release + tag]         ← external
```

Each step is a single command (or two for build). No design surface area; the value is in **sequencing + verification gates** so a partial release doesn't ship.

## Step 1 — Bump version + CHANGELOG

**Files**:
- `package.json` line ~5: `"version": "0.3.1"` → `"0.3.2"`.
- `CHANGELOG.md`: insert new section, move `[Unreleased]` compare link target.

**CHANGELOG excerpt** to add (matching the style of `0.3.1`'s entry):

```markdown
## [0.3.2] - 2026-08-25

### Fixed

- **i18n lang pipeline: 5 处 code-review 加固**（commit `793bcfe`，基于 08-23
  `ui-lang-toggle` review 结果）：
  - **`LangStore.currentLang()` 'auto' 不再被 module override 污染**
    （`src/util/langStore.ts`）：之前调 `i18n.detectLang()` 读 module-level
    override，`auto → zh → en → auto` 循环无法回到跟随环境。改走新加的
    `detectEnvLang()`（env only，绕过 override），让 `auto` 的语义在数据层
    独立成立。`src/extension.ts` 的 `onDidChangeConfiguration` 监听器在
    pref=`auto` 时显式 `setLangOverride(undefined)`，spec 合规（`.trellis/spec/i18n.md:20`）。
  - **`toggleLanguageCommand` catch 块 null-safe**（`src/extension.ts`）：
    `workspace.getConfiguration().update()` 可能 reject null/undefined，
    `(e as Error).message` 会让错误处理器自身抛 TypeError。改为
    `e instanceof Error ? e.message : String(e)`。
  - **`LangStore` 构造器 / `syncFromConfig` 加固**（`src/util/langStore.ts`）：
    新增 `isLangPref()` typeguard（基于 `PREF_ORDER`），非法 pref 回落到
    `auto` + `console.warn`。数据层先挡住，避免 UI 看到污染数据。
  - **`LangToggle.render()` 复用 `isLangPref`**（`src/ui/langToggle.ts`）：
    删除本地 `safePref()` 枚举检查，单一事实源（`PREF_ORDER`），新 pref 加入
    只需改一处。
  - **`detectEnvLang()` + `isLangPref()` 文档**（`src/i18n/index.ts`、
    `src/util/langStore.ts`）：新公共 API JSDoc 写明语义边界。

### Testing

- 单元测试：227 passed（195 既有 + 32 新）。新增 `detectEnvLang` 5 例、
  `LangStore.currentLang` 与 override 隔离 2 例、防御性 fallback 3 例、
  `isLangPref` 参数化 2 组。
```

Plus footer line:
```markdown
[0.3.2]: https://github.com/codewithwu/Claude-Task-Monitor/compare/v0.3.1...v0.3.2
```

And update the `[Unreleased]` line:
```markdown
[Unreleased]: https://github.com/codewithwu/Claude-Task-Monitor/compare/v0.3.2...HEAD
```

**Commit**: `chore: bump version 0.3.1 → 0.3.2 + CHANGELOG`

## Step 2 — Build `.vsix`

```
pnpm package
```

Script (per `package.json`):
```
vsce package --no-dependencies && mkdir -p packages && mv *.vsix packages/
```

- `--no-dependencies` because extension has zero production deps (only `chokidar` which is in devDependencies and bundled via tsup).
- `vsce package` reads version from `package.json` so the bumped version flows into the filename automatically.
- Output: `packages/codewithwu-cn.claude-task-monitor-0.3.2.vsix`.

**Verification gate**:
```
ls -lh packages/codewithwu-cn.claude-task-monitor-0.3.2.vsix
# expect: >100 KB, exactly one .vsix file in packages/
```

## Step 3 — Publish to Open VSX

```
ovsx publish packages/codewithwu-cn.claude-task-monitor-0.3.2.vsix
```

`OVSX_PAT` env var is auto-picked-up by `ovsx` (length 43 chars verified at session start; never print value).

**Verification gate**:
```
ovsx get codewithwu-cn.claude-task-monitor
# expect: Downloading ... v0.3.2 (and side-effect: downloads .vsix to cwd — delete after)
```

The `ovsx get` has a side effect of downloading the .vsix to current dir. Clean up after.

## Step 4 — GitHub release

Extract the `[0.3.2]` section from CHANGELOG into a temp file:

```
awk '/^## \[0\.3\.2\]/{flag=1} /^## \[0\.3\.1\]/{flag=0} flag' CHANGELOG.md > /tmp/v0.3.2-notes.md
```

Then:
```
gh release create v0.3.2 \
  packages/codewithwu-cn.claude-task-monitor-0.3.2.vsix \
  --title "v0.3.2" \
  --notes-file /tmp/v0.3.2-notes.md
```

`gh release create` auto-creates the git tag (`v0.3.2`) and pushes it. Asset uploads from local file. Title matches prior releases.

**Verification gate**:
```
gh release view v0.3.2
# expect: title=v0.3.2, 1 asset, body contains "## [0.3.2]" header
```

## Sequencing rationale

1. Bump version **before** build — so the .vsix filename includes 0.3.2.
2. Build **before** publish — can't publish what doesn't exist.
3. Publish to Open VSX **before** GitHub release — Open VSX is irreversible per version (mit R3); get that gate passed first.
4. GitHub release last — it's the public artifact users see; should be ready when tagged.

If any gate fails after publish, the Open VSX version is locked. Recovery: bump to 0.3.3, ship again. Don't waste energy on partial retries.

## Rollback

| Step | Rollback |
|---|---|
| 1 (commit) | `git revert <commit-hash>` |
| 2 (build) | `rm packages/codewithwu-cn.claude-task-monitor-0.3.2.vsix` |
| 3 (OVSX) | None. Cannot unpublish. |
| 4 (GitHub) | `gh release delete v0.3.2` + `git push origin :v0.3.2` (also delete local tag) |

The committed CHANGELOG + package.json should be reverted together so the repo state matches what shipped (or didn't).