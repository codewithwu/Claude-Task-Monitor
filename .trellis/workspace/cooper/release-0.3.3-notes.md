## [0.3.3] - 2026-08-27

### Fixed

- **i18n lang pipeline round 2 加固，7 处 code-review 落实**（commit `4f86ab6`）:
  - **toast 渲染新增 `formatToggleFailMessage` 辅助 + 双分支 `String()` 兜底**
    （`src/extension.ts` + `src/util/formatError.ts`）：`(e as Error).message` 在
    `Error.message === null/undefined` 时返回字面量 `null`/`undefined`，直接套进
    `i18n.format(key, undefined)` 会漏出 `{0}` 占位符。两处 `instanceof Error`
    分支都补 `String(e)` 兜底；非 Error 对象（含 Promise rejection 等）走
    `String(e)`，不再依赖 `as Error` 的危险断言。
  - **`detectLang` / `detectEnvLang` 共享 `fromEnv()` 私有 helper**
    （`src/i18n/index.ts`）：env-language 解析（`vscode.env.language` startsWith
    `'zh'`）从两个公开函数里抽出来，以后加 ja/ko 等只改一处。
  - **activation path 切到 listener 写法**（`src/extension.ts`）：
    `setLangOverride(auto ? undefined : pref)` 与 `onDidChangeConfiguration`
    listener 保持一致；`pref='auto'` 路径下 override 一律是 `undefined`，不再有
    `i18n.detectLang()` 旁路污染。
  - **删除 `ui/langToggle.ts` 不可达防御分支**：`getPref: () => LangPref`
    已经收窄到 `LangPref` 类型，`LangStore` 是数据边界，把 `if (!pref)` 的
    fallback 移到构造器 throw，单一事实源。
  - **删除 `lang.toggle.invalid` i18n key**（`src/i18n/messages/{en,zh}.ts`）：
    round 2 把非法 pref 兜底上移到 LangStore 构造器 + `isLangPref()`，用户态
    `safePref()` 已移除，message key 跟着下线。
  - **修正 spec ownership 段落**（`.trellis/spec/i18n.md`）：override 实际由
    `extension.ts` 的 config listener 写入，不是 `LangStore`——这样 LangStore
    才能在 unit test 里独立 mock，跟"listener 写、store 读"的契约对齐。
  - **替换脆弱的 `:20` 行号引用为 stable anchor**
    （`src/extension.ts`：`.trellis/spec/i18n.md#manual-language-override`）：
    spec 行号飘移后 comment 就指错地方。

### Testing

- 新增 `langToggle.test.ts` (8 cases)、`formatError.test.ts` (13 cases)、
  `i18n.test.ts` +2 (FR3 错误信息渲染)。

- **i18n lang pipeline round 3 加固，10 处 code-review 落实**（commit `534a35f`）:
  - **activation path 改读 `langStore.get()` 而不是 raw `langPref`**
    （`src/extension.ts:83`）：settings.json 手编辑成 enum 之外的 `"fr"`
    在 activation 阶段被 `isLangPref()` 归一化到 `'auto'`，
    `setLangOverride` 不再被非法 cfg 污染。
  - **`formatToggleFailMessage` → `formatErrorMessage` 重命名**
    （`src/util/formatError.ts`）：这个 helper 是 generic error formatter
    而非 toggle 专属，名字收紧职责。
  - **8 处 `(e as Error).message` → `formatErrorMessage()` 重写**
    （`src/extension.ts` 5 处、`src/util/muted.ts` 2 处、
    `src/watcher.ts:93`）：原本的 `as Error` 在 non-Error rejection 上抛
    `TypeError`；现在统一走 helper 的 `instanceof + String()` 双分支兜底。
  - **`new Error()` 不再渲染成空 body**：之前用 `??`，
    `e.message === ''` 时回退到 `''`，最终 toast 是 `'Failed to switch UI
    language: '`（尾随冒号 + 空 body）。改 `||`，fallback 是 `'Error'`，
    至少给用户一个占位。
  - **spec listener 模式文档同步**（`.trellis/spec/i18n.md:27`）：从
    `langStore.currentLang()` 旧形式切到 `setLangOverride(undefined)`
    listener 写法，跟实际代码对齐。
  - **`langStore.ts:60` JSDoc 重写**：明确 `extension.ts` 的
    `onDidChangeConfiguration` 是 `setLangOverride` 的唯一写入者，
    LangStore 自身不写。
  - **修 broken spec reference**（`src/extension.ts:406`）：
    `.trellis/spec/i18n.md` 完整路径 + GitHub-flavored anchor slug
    `#manual-language-override-08-23-ui-lang-toggle`，不再裸 `:20`。
  - **`test/langToggle.test.ts` 收紧**：删除 dead `createSpy` 变量；
    加 zh-render case（mock `vscode.env.language='zh'`）让过宽的
    `/English|中文/` regex 不再 vacuous pass。
  - **`test/i18n.test.ts:213` comment 修正**：`extension.ts:83`
    （漂移前 `:80`）。
  - **POSIX trailing newline** 加到 `test/i18n.test.ts`。

### Testing

- `test/formatError.test.ts` 重命名为 `formatErrorMessage`，更新
  `new Error()` 期望从 `''` 到 `'Error'`，新增 regression case。
- 253/253 unit tests pass（+3：FR1 invalid cfg, FR3 empty-message,
  FR8 Chinese render）。
- 9/9 grep gates pass；typecheck 仅有 pre-existing errors，与本批无关。