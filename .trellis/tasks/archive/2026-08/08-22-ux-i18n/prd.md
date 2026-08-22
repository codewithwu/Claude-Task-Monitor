# P2-15: 国际化 i18n (中英双语)

## Goal

UI 文案 / status / command title / package.json displayName 现状中英混搭,影响全球上架。建议方案:(a) 自建 `i18n/{zh,en}.ts` + VS Code `nls.metadata.json`,运行时根据 `vscode.env.language` 选;(b) 至少先统一 `package.json` 的 `displayName` / `description` 中英文版本;(c) command title 全英文(标准做法),UI 文案保留中英切换能力。

## Requirements

- 新增 `package.nls.json`(英文 fallback) + `package.nls.zh-cn.json`(中文)
- 所有 command `title` / `category` 走 nls(必须英文,VS Code 市场规范)
- UI 文案(onboarding 文字 / status bar tooltip / notification 文案 / Welcome View / status label)抽到 `src/i18n/{en,zh}.ts`
- 运行时根据 `vscode.env.language` 选(zh-cn / zh-tw / zh-* 走中文,其他走英文)
- `package.json` `displayName` / `description` 提供中英双语(英文 nls fallback,中文 nls.zh-cn)
- 单测覆盖 i18n 切换(模拟 env.language)

## Acceptance Criteria

- [ ] `code --locale=zh-cn` 启动后所有 UI 文案中文
- [ ] `code --locale=en` 启动后所有 UI 文案英文
- [ ] command title 在两种 locale 下都显示(英文,符合市场规范)
- [ ] 不破坏现有单测断言(英文为默认 fallback)
- [ ] package.json `displayName` / `description` 双语,nls.zh-cn 优先
- [ ] i18n 文件单独可测(纯函数)

## Notes

- 父任务:[08-22-ux-optimization-roadmap](../08-22-ux-optimization-roadmap/)
- **大改动**,建议排在最后实现;预计影响 ~30 处文案
- 与 P2-14/16(`ux-config-welcome-entries`)联动:Welcome View 文案本身要 i18n
- 关键决策:`vscode.l10n.t()` (官方推荐) vs 自建 i18n 函数(更灵活)
  - 推荐自建:目前文案量不大,自建可避免 l10n bundle 编译复杂度
- 影响文件:几乎所有 `src/` 下的 `.ts` + `package.json`