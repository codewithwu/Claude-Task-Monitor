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

---

## Task: fix-v020-leftovers (2026-08-23)

清理 `/code-review @src/` 在 commit `be68481` 上扫出的 10 个 verified finding:
- 7 个 i18n 收尾 (notification 按钮 / badge tooltip / rowPresentation status labels / viewsWelcome / 错乱的 zh-cn togglePin 翻译 / banner.jqMissing 多余 `[`)
- 3 个真 bug (cfg `longWaitingThresholdSec` 注释撒谎需 reload → 改为真热更新 / `formatAggregateMessage` 和 `formatWaitingTooltip` 的 "more" 计数用 n 而非 n-MAX → 改对 / `currentFilter` 中间变量删除)

故意不修:
- Finding 9 (`t()` 把字面量 'en'/'zh' 当 lang override 吞掉的 footgun): `i18n.test.ts:94-100` 显式文档化,生产无触发,改 API 要审 8 个 caller → 见 `.trellis/spec/i18n.md` "Deliberate non-fix" 段
- `deactivate()` 的中文按钮 + 其他 5 处 toast: 不在 finding list,保持 scope 紧凑

实现要点:
- i18n: 新增 5 个 key (`badge.tooltip.one/many` + `status.label.waiting/running/idle`) + 修 `banner.jqMissing` typo + viewsWelcome 改 `%welcome.content%`
- 新增 `src/test/i18n.test.ts:101-110` 对称性测试 (`Object.keys(en).sort() === Object.keys(zh).sort()`),防止单边加 key 的 #2/#3/#5/#6 类 bug 重现
- 引入 i18n 的 4 个测试 (`badge.test.ts`, `rowPresentation.test.ts`) 加 `vi.mock('vscode', () => ({ env: { language: 'zh-cn' } }))` mock,跟现有 `notifyMessage.test.ts`/`statusBar.test.ts` 模式一致
- cfg 热更新: `treeDataProvider.longWaitThresholdSec` 去 `readonly` + 新增 `setLongWaitThreshold(sec)` setter + `extension.ts` 注册 `workspace.onDidChangeConfiguration` 监听器
- 修两处 "more" 计数 bug: `notifyMessage.ts:27` 和 `statusBarContent.ts:54`,同步更新 3 个测试断言 (`notifyMessage.test.ts:57` 期望 `等 2 个`,`statusBar.test.ts:82/97` 期望 `等 1 个`)

Commit 拆分:extension.ts 同时含 Commit A (notify 按钮 i18n) 和 Commit B (currentFilter + cfg 监听 + 注释) 的改动,为避免 partial staging 复杂度,所有 extension.ts 改动归到 Commit B,Commit A 用 10 个纯 i18n 文件,Commit B 用 6 个文件。

测试: 185 → 186 cases (+1, i18n key 对称性测试)

新 spec 文件:
- `.trellis/spec/i18n.md` — 完整 i18n 模块设计 (自建 t() 而非 vscode.l10n 的 6 条理由 / 命名约定 / 占位符 / deliberate non-fix 论证 / 测试模式 / package metadata 本地化 / out-of-scope)
- `testing.md` 添加一行 mock table 引用 `i18n` spec
- `index.md` Guidelines Index 添加 i18n 入口

### Git Commits

| Hash | Message |
|------|---------|
| `68e3991` | i18n: close v0.2.0 refactor leftovers |
| `6055292` | fix: cfg hot-update + correct aggregate 'more' count + i18n buttons + simplify |

### Status

[OK] **Completed**


## Session 3: Fix v0.2.0 refactor leftovers (i18n + 3 bugs)

**Date**: 2026-08-23
**Task**: Fix v0.2.0 refactor leftovers (i18n + 3 bugs)
**Branch**: `main`

### Summary

Closed 10 verified findings from /code-review @src/ on commit be68481. 7 i18n cleanups (notification buttons, badge tooltip, rowPresentation status labels, viewsWelcome content, zh-cn togglePin title, banner.jqMissing typo, plus new badge.tooltip.* / status.label.* / welcome.content keys), 3 real bug fixes (cfg longWaitingThresholdSec hot-update via onDidChangeConfiguration listener, notifyMessage+statusBarContent 'more' count fix, currentFilter dead variable collapse). Added i18n key symmetry test (185→186 tests). New .trellis/spec/i18n.md capturing module design + deliberate non-fix on t() lang detection footgun.

### Main Changes

- i18n: 5 new symmetric keys (badge.tooltip.{one,many}, status.label.{waiting,running,idle}); fixed banner.jqMissing stray '['; zh-cn togglePin.title translated
- i18n: package.json viewsWelcome → %welcome.content% + matching en/zh entries in package.nls*.json
- i18n: extension.ts notification action buttons now use t('notify.action.*') (keys existed but were never referenced — en users saw Chinese buttons)
- i18n: badge.ts tooltip + rowPresentation.ts statusLabel() both go through t()
- fix: extension.ts adds workspace.onDidChangeConfiguration listener for longWaitingThresholdSec; treeDataProvider loses readonly + gains setLongWaitThreshold setter
- fix: notifyMessage.ts:27 + statusBarContent.ts:54 'more' count from n → n-MAX (was 5-and-5-more / 5-等-5-个, now 5-and-2-more / 5-等-2-个)
- simplify: extension.ts:67-68 collapse dead currentFilter intermediate var (4 lines → 1)
- test: src/test/i18n.test.ts adds en/zh key-set symmetry assertion (Object.keys sort equality) — prevents future single-side additions
- spec: new .trellis/spec/i18n.md captures module design + Finding 9 deliberate non-fix + vi.mock pattern + package metadata localization

### Git Commits

| Hash | Message |
|------|---------|
| `68e3991` | (see git log) |
| `6055292` | (see git log) |
| `8580479` | (see git log) |

### Testing

- [OK] pnpm test: 186/186 pass (was 185; +1 from symmetry test)
- [OK] pnpm build: tsup success, dist/extension.js 232.42 KB
- [OK] trellis-check verdict: PASS — all 10 ACs verified across 16 files

### Status

[OK] **Completed**

### Next Steps

- git push origin main (4 commits ahead of origin)
- Future backlog (out of scope here): extension.ts:deactivate() '是'/'否' buttons + 5 other Chinese toasts (lines 82/89/159/461/468) — see .trellis/spec/i18n.md 'Out of scope' section
- Future backlog: integration test for cfg onDidChangeConfiguration hot-update path (currently manual-verification only)


## Session 4: Address 7 code-review findings on i18n/lang pipeline (round 2)

**Date**: 2026-08-26
**Task**: Address 7 code-review findings on i18n/lang pipeline (round 2)
**Branch**: `main`

### Summary

Closed 7 follow-up findings from /code-review @src/ on 2026-08-26 against the 08-25 i18n/lang patch: real bug (extension.ts:330 Error fallback regressed — lost String() fallback when Error.message is null/undefined, leaked {0} template placeholder), duplication (i18n/index.ts detectEnvLang + detectLang both did env.startsWith('zh') verbatim), inconsistency (activation wrote setLangOverride(langStore.currentLang()) while listener wrote undefined for auto), dead code (ui/langToggle.ts unreachable isLangPref defensive branch — getPref typed () => LangPref after 08-25 hardening), spec/code mismatch (langStore.ts:60 JSDoc vs spec on override writer ownership), brittle cite (extension.ts:404 hardcoded spec line :20), test gap (no langToggle.test.ts). Net: +212/-27 across 7 modified + 3 new files. 250/250 tests pass; tsc shows only 4 pre-existing errors on main.

### Main Changes

- fix(i18n): extension.ts:330 toast extracts formatToggleFailMessage helper — String() fallback on both branches of instanceof check (Error.message === null/undefined no longer leaks {0})
- fix(i18n): i18n/index.ts extracts private fromEnv() helper; detectLang and detectEnvLang both route through it (single source for env-language resolution)
- fix(i18n): extension.ts activation writes setLangOverride(auto ? undefined : pref), matching the listener pattern; override is consistently undefined for pref='auto' regardless of code path
- fix(i18n): ui/langToggle.ts deletes unreachable defensive branch (LangStore is data boundary); moves one-time isLangPref check to constructor throw
- chore(i18n): removes lang.toggle.invalid key from messages/en.ts and messages/zh.ts (no remaining callers; symmetry test still green)
- docs(spec): i18n.md corrects override ownership paragraph — written by extension.ts config listener, not LangStore (LangStore stays decoupled from i18n for unit-testability, matching langStore.ts:8-9 rationale)
- chore(docs): extension.ts:404 area replaces brittle ':20' line cite with stable spec/i18n.md#manual-language-override anchor
- test: src/test/langToggle.test.ts (8 cases) — render with each pref, tooltip composition, render-after-change, dispose, constructor-throw, command, priority
- test: src/test/formatError.test.ts (13 cases) — Error with normal/empty/null/undefined message, non-Error rejects (string/number/bool/null/undefined/object), {0} never leaks
- test: src/test/i18n.test.ts +2 FR3 cases — setLangOverride(undefined) + env=en/zh → detectLang returns env

### Git Commits

| Hash | Message |
|------|---------|
| `4f86ab6` | (see git log) |

### Testing

- [OK] pnpm test: 250/250 pass across 18 test files (was 239/239; +11 from formatError + langToggle + i18n additions)
- [OK] pnpm exec tsc --noEmit: 4 pre-existing errors at extension.ts:241/242/312/461 — identical on main (lines 238/239/309/458 shifted by +3 from FR3 comment); not introduced by this task
- [OK] grep 'startsWith(.zh.)' src/i18n/index.ts: 1 hit (inside fromEnv; was 2 before refactor)
- [OK] grep 'lang.toggle.invalid' src/: 0 hits
- [OK] grep 'i18n.md:20' src/: 0 hits
- [OK] trellis-check verdict: READY TO COMMIT (10/10 ACs pass, all 3 implement-agent deviations technically correct)
- [OK] code-review re-verify: CLEAN — all 7 original findings GONE, no net-new issues introduced

### Status

[OK] **Completed**

### Next Steps

- git push origin main (1 commit ahead of origin: 4f86ab6)
- Future backlog (out of scope here): extension.ts:deactivate() '是'/'否' buttons + 5 other Chinese toasts (lines 82/89/159/461/468) — see .trellis/spec/i18n.md 'Out of scope' section
- Future backlog: investigate the 4 pre-existing tsc errors on main (extension.ts:241/242/312/461 — SessionGroup undefined / TreeElement not assignable / FilterMode | undefined / MarkdownString not assignable) — not introduced by this task but should be tracked separately


## Session 5: 跨窗口通知去重 (leader election)

**Date**: 2026-09-02
**Task**: 跨窗口通知去重 (leader election)
**Branch**: `main`

### Summary

多开 VS Code 窗口时同一 waiting 事件只弹 1 条 toast。新增 src/util/leaderLock.ts (纯 fs,零 vscode import, fail-open, per-host 隔离) + src/test/leaderLock.test.ts (20 例,含真实 child process 多进程)。Notifier 类型签名零改动 (F3)。CHANGELOG [Unreleased] 加 Added 段。

### Git Commits

| Hash | Message |
|------|---------|
| `cdb72cb` | (see git log) |
| `e362bfa` | (see git log) |

### Status

[OK] **Completed**
