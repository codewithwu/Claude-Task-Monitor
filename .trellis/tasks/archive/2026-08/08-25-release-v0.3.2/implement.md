# Implement — Release v0.3.2

## Execution order (linear, no parallel)

1. Verify OVSX_PAT length (already done in prereq check; 43 chars).
2. Edit `package.json` (version bump).
3. Edit `CHANGELOG.md` (insert [0.3.2] section + update [Unreleased] compare target + add [0.3.2] link).
4. Commit version bump.
5. `pnpm package` (build .vsix).
6. Verify .vsix exists in `packages/`.
7. `ovsx publish packages/codewithwu-cn.claude-task-monitor-0.3.2.vsix`.
8. Verify with `ovsx get codewithwu-cn.claude-task-monitor`.
9. Clean up the .vsix side-effect of `ovsx get` at repo root.
10. Extract `[0.3.2]` section to temp file.
11. `gh release create v0.3.2 ...` with --notes-file.
12. Verify with `gh release view v0.3.2`.
13. (Final sanity) `pnpm test`.

## Step-by-step

### Step 1 — Pre-flight (already verified in prereq check)
```
echo "OVSX_PAT length: ${#OVSX_PAT}"   # expect: > 0
which ovsx                              # expect: /home/cooper/.nvm/.../ovsx
ovsx get codewithwu-cn.claude-task-monitor --metadata 2>&1 | head -3
# expect: namespace exists, current latest is 0.3.1
gh auth status                          # expect: Logged in to github.com
```
✅ Already passed in prereq phase.

### Step 2 — Bump version

Read `package.json` lines 4-7 (the metadata block) to see the exact text, then edit `"version": "0.3.1"` → `"version": "0.3.2"`.

### Step 3 — Edit CHANGELOG.md

Three edits:
1. Insert `## [0.3.2] - 2026-08-25` section between `[Unreleased]` and `## [0.3.1] - 2026-08-24`.
2. Update `[Unreleased]: ...compare/v0.3.1...HEAD` → `compare/v0.3.2...HEAD`.
3. Insert `[0.3.2]: https://github.com/codewithwu/Claude-Task-Monitor/compare/v0.3.1...v0.3.2` near the bottom link references, before the `[0.3.1]` link.

The new section content (matches style of 0.3.1 entry, condensed):

```markdown
## [0.3.2] - 2026-08-25

### Fixed

- **i18n lang pipeline 5 处 code-review 加固**（commit `793bcfe`，08-23
  `ui-lang-toggle` review 后续）：
  - **`LangStore.currentLang()` 'auto' 不再被 module override 污染**
    （`src/util/langStore.ts`）：之前调 `i18n.detectLang()` 读 override，
    `auto → zh → en → auto` 循环回不到 env。新增 `detectEnvLang()`（env only，
    绕过 override）专供 `currentLang()` 的 'auto' 分支，让语义在数据层独立。
    `src/extension.ts` 的 config 监听器在 pref=`auto` 时显式
    `setLangOverride(undefined)`，与 `.trellis/spec/i18n.md:20` 对齐。
  - **`toggleLanguageCommand` catch 块 null-safe**（`src/extension.ts`）：
    `workspace.getConfiguration().update()` 可能 reject null/undefined，
    `(e as Error).message` 让错误处理本身抛 TypeError。改为
    `e instanceof Error ? e.message : String(e)`。
  - **`LangStore` 数据层加 `isLangPref()` 守卫**（`src/util/langStore.ts`）：
    构造器 + `syncFromConfig()` 收到非法 pref 回落到 `'auto'` +
    `console.warn`。`LangToggle.render()` 也改用 `isLangPref()`，删除本地
    `safePref()`，单一事实源（`PREF_ORDER`）。

### Testing

- 单元测试 227 passed（195 既有 + 32 新）。
```

### Step 4 — Commit

```
git add package.json CHANGELOG.md
git commit -m "chore: bump version 0.3.1 → 0.3.2 + CHANGELOG"
```

### Step 5 — Build

```
pnpm package
```

Watch for any `vsce` warnings (missing license, missing repo URL, etc.). The repo has all of these (`LICENSE` file present, repo URL in `package.json`).

### Step 6 — Verify build

```
ls -lh packages/
# expect: codewithwu-cn.claude-task-monitor-0.3.2.vsix, > 100 KB
```

### Step 7 — Publish to Open VSX

```
ovsx publish packages/codewithwu-cn.claude-task-monitor-0.3.2.vsix
```

If `OVSX_PAT` is in env, ovsx picks it up automatically. If not, append `--pat "$OVSX_PAT"`.

### Step 8 — Verify Open VSX

```
ovsx get codewithwu-cn.claude-task-monitor --metadata 2>&1 | head -20
# expect: latestVersion in metadata = 0.3.2
```

### Step 9 — Cleanup `ovsx get` side-effect

`ovsx get` without `--metadata` downloads the .vsix to cwd. We used `--metadata` to avoid the download. If we used a plain `ovsx get`, clean up:
```
rm -f codewithwu-cn.claude-task-monitor-0.3.2.vsix
```

### Step 10 — Extract CHANGELOG excerpt

```
awk '/^## \[0\.3\.2\]/{flag=1} /^## \[0\.3\.1\]/{flag=0} flag' CHANGELOG.md > /tmp/v0.3.2-notes.md
cat /tmp/v0.3.2-notes.md  # verify content matches the new section
```

### Step 11 — GitHub release

```
gh release create v0.3.2 \
  packages/codewithwu-cn.claude-task-monitor-0.3.2.vsix \
  --title "v0.3.2" \
  --notes-file /tmp/v0.3.2-notes.md
```

`gh` auto-creates the tag and pushes it. Asset uploads from local file.

### Step 12 — Verify GitHub release

```
gh release view v0.3.2
# expect: title "v0.3.2", 1 asset named codewithwu-cn.claude-task-monitor-0.3.2.vsix,
# body contains "## [0.3.2]" header
```

### Step 13 — Final sanity

```
pnpm test 2>&1 | tail -5
# expect: Tests 227 passed (227)
```

(No src/ changes this task, so this is just a confidence check.)

## Review gates

- **After step 4**: `git log --oneline -3` shows the version bump commit on top of `793bcfe`.
- **After step 6**: `packages/codewithwu-cn.claude-task-monitor-0.3.2.vsix` exists; `unzip -l` shows `extension.js` + `package.json` (sanity-check the .vsix is valid).
- **After step 8**: `ovsx get` metadata confirms v0.3.2 latest.
- **After step 12**: `gh release view v0.3.2` shows everything.

## Rollback

If OVSX publish succeeded but GitHub release failed:
- Open VSX is locked at v0.3.2.
- Either retry `gh release create v0.3.2` (it can be re-run — the tag/asset upload is idempotent on retry), or ship GitHub release without .vsix asset and link to Open VSX URL.

If GitHub release succeeded but OVSX publish failed:
- The .vsix on GitHub is harmless without OVSX listing.
- Retry OVSX publish (the same artifact, same namespace — usually a transient network issue per R3).
- Worst case: ship 0.3.3 with the publish retried.

If both fail before the version-bump commit: just `git revert` the commit. No external state touched.

If both fail after the commit but before any external state: `git revert` + delete any local tag.

## Out of scope (re-stated)

- VS Code marketplace publishing (`vsce publish`).
- Editing displayName / description / nls strings.
- `.github/workflows` release automation.
- Tag signing.