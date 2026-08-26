# Design — Address 7 code-review findings on i18n/lang pipeline (round 2)

## Architecture overview

The 7 findings cluster around the same 3-layer stack from 08-25:

```
┌──────────────────────────────────────────────────────────────────┐
│ UI:  src/ui/langToggle.ts                                        │
│      - render(): isLangPref guard + LABELS[raw] + tooltip        │
│      - ↑ guard is unreachable (FR4)                              │
│      - ↑ no dedicated test file (FR7)                            │
└───────────────────────┬─────────────────────────────────────────┘
                        │ getPref() — typed () => LangPref
┌───────────────────────▼─────────────────────────────────────────┐
│ Store: src/util/langStore.ts                                     │
│      - constructor + syncFromConfig both validate via isLangPref │
│      - currentLang() = auto ? detectEnvLang() : pref             │
│      - JSDoc says "extension.ts config listener writes override" │
│        but spec says "LangStore writes override" (FR5)            │
└───────────────────────┬─────────────────────────────────────────┘
                        │ reads override + detects env
┌───────────────────────▼─────────────────────────────────────────┐
│ i18n: src/i18n/index.ts                                          │
│      - detectLang():     override ?? env.startsWith('zh')        │
│      - detectEnvLang():  env.startsWith('zh')                    │
│      - ↑ two functions, one logic, no shared helper (FR2)        │
└──────────────────────────────────────────────────────────────────┘

extension.ts:
  - L80 activation: setLangOverride(langStore.currentLang())   ← FR3 inconsistent
  - L330 toggle catch: e instanceof Error ? e.message : String(e)  ← FR1 leaks {0}
  - L404 spec cite: hardcoded :20                              ← FR6 brittle
  - L408-409 listener: setLangOverride(auto ? undefined : pref)
```

Each finding maps to a small, localized change. The cross-cutting concerns are:
1. **Spec/code ownership** (FR5) — decide once whether LangStore or the listener owns override writing. Pick the listener (preserves the 08-25 design); update the spec to match.
2. **Single-source env** (FR2) — extract a private `fromEnv()`; both `detectLang` and `detectEnvLang` route through it.
3. **Activation consistency** (FR3) — apply the listener's `auto ? undefined : pref` pattern at activation too.

The dead code (FR4) and the test gap (FR7) are mechanical; the brittle cite (FR6) is a doc fix.

## Change 1 — Fix `extension.ts:330` error fallback (FR1)

**File**: `src/extension.ts:330`

```ts
// before:
t('lang.toggle.fail', e instanceof Error ? e.message : String(e))

// after:
t('lang.toggle.fail', e instanceof Error ? (e.message ?? String(e)) : String(e))
```

Why: the comment block at lines 322-324 already says "instanceof Error 兜底 + String() 兜底", but the implementation only applies `String()` on the non-Error branch. An `Error` whose `.message` is `null`/`undefined` (wrapper-library edge case, the exact scenario the comment cites) flows through the truthy check on `e.message` to a falsy value, then `t()`'s `arg === undefined ? '{${idx}}' : String(arg)` path produces the literal `{0}` — a template placeholder leak to the user.

**Test strategy**: extract the catch body into a small named helper for testability — `formatToggleFailMessage(e: unknown): string`. Then test directly:

```ts
// src/test/extension.test.ts (new) or src/test/langToggle.test.ts (extended)
describe('formatToggleFailMessage (08-26)', () => {
  it.each([
    [new Error('boom'), 'boom'],
    [new Error(), 'Error'],                                    // no message → use 'Error' (String(e))
    [{ message: null }, 'null'],                               // non-Error, null message → 'null'
    [{ message: undefined }, '[object Object]'],               // non-Error, no message → String()
    ['string-reject', 'string-reject'],                        // string reject
    [null, 'null'],                                            // null reject
    [undefined, 'undefined'],                                  // undefined reject
  ])('formats %p → %p', (input, expected) => {
    expect(formatToggleFailMessage(input)).toBe(expected)
  })

  it('never returns the literal {0} template placeholder', () => {
    expect(formatToggleFailMessage(new Error())).not.toContain('{0}')
    expect(formatToggleFailMessage({ message: null })).not.toContain('{0}')
    expect(formatToggleFailMessage(undefined)).not.toContain('{0}')
  })
})
```

The helper signature:
```ts
export function formatToggleFailMessage(e: unknown): string {
  return e instanceof Error ? (e.message ?? String(e)) : String(e)
}
```

Place it in `extension.ts` near the command registration (private to that file), or — if we want it in a utility module to make the import clean — put it in `src/util/formatError.ts`. **Decision**: keep it in `extension.ts` as a non-exported helper, and write the test as an integration-style test that imports it via `require` of the compiled module, or extract to `src/util/formatError.ts` so it's importable in `langToggle.test.ts` (already imports from `src/util/`). Going with `src/util/formatError.ts` — it's small enough to deserve its own file and gets cleaner test coverage.

## Change 2 — Extract `fromEnv()` in `i18n/index.ts` (FR2)

**File**: `src/i18n/index.ts`

```ts
// new private helper, top of file
function fromEnv(): Lang {
  return vscode.env.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

// detectLang: read override, then fromEnv
export function detectLang(): Lang {
  return override ?? fromEnv()
}

// detectEnvLang: env only
export function detectEnvLang(): Lang {
  return fromEnv()
}
```

Note: the original `detectLang` uses `if (override) return override` (truthy check). Switching to `??` is a behavior change for `override === ''` (empty string), but `override` is typed `Lang | undefined` and the only writers are `setLangOverride(lang)` which takes `Lang | undefined`. So `override` is never `''` in practice. Use `??` to keep the type-narrowing clear.

Update the header comment at lines 8-10:
```
//   - vscode.env.language 以 'zh' 开头 → 中文  (fromEnv, single source)
//   - 其他 → 英文 (默认 fallback)
```

Verification: `grep "startsWith('zh')" src/i18n/index.ts` → exactly 1 hit (inside `fromEnv`).

## Change 3 — Activation writes `undefined` for `auto` (FR3)

**File**: `src/extension.ts:78-80`

```ts
// before:
const langPref = cfg.get<LangPref>('language', 'auto')
const langStore = new LangStore(langPref)
setLangOverride(langStore.currentLang())

// after:
const langPref = cfg.get<LangPref>('language', 'auto')
const langStore = new LangStore(langPref)
// 与 onDidChangeConfiguration 监听器 (L408) 对齐:auto 写 undefined,
// 让 t() 全局也回落到 env (spec .trellis/spec/i18n.md#manual-language-override)
setLangOverride(langPref === 'auto' ? undefined : langPref)
```

The semantic outcome for `auto` is identical to `langStore.currentLang()` (env-derived after FR2 refactor + 08-25 `detectEnvLang`); but the internal override state is consistent: `undefined` for `auto`, concrete for `zh`/`en`, regardless of which path set it.

Side benefit: this matches the listener's pattern, so future readers don't have to remember "two paths, one truth" — there's just one pattern repeated.

## Change 4 — Delete dead defensive branch (FR4)

**File**: `src/ui/langToggle.ts:44-62`

Before:
```ts
render(): void {
  const raw = this.getPref()
  if (!isLangPref(raw)) {
    this.item.text = '$(globe) ?'
    this.item.tooltip = t('lang.toggle.invalid', raw)
    return
  }
  const next = nextPref(raw)
  this.item.text = `$(globe) ${LABELS[raw]}`
  this.item.tooltip = t(
    'lang.toggle.tooltip',
    t(`lang.toggle.state.${raw}`),
    t(`lang.toggle.state.${next}`)
  )
}
```

After:
```ts
render(): void {
  const raw = this.getPref()  // typed LangPref; LangStore is the data boundary
  const next = nextPref(raw)
  this.item.text = `$(globe) ${LABELS[raw]}`
  this.item.tooltip = t(
    'lang.toggle.tooltip',
    t(`lang.toggle.state.${raw}`),
    t(`lang.toggle.state.${next}`)
  )
}
```

Plus add a one-time construction-time check to satisfy R1 (defense shifted from render to construction):

```ts
constructor(private readonly getPref: () => LangPref) {
  if (!isLangPref(getPref())) {
    throw new Error(
      `[claude-task-monitor] LangToggle: getPref() returned invalid value; ` +
      `LangStore should be the data boundary.`
    )
  }
  this.item = vscode.window.createStatusBarItem(...)
  ...
}
```

This is the right place for the check: it fires once at construction, catches a programming error early, and the `() => LangPref` getter contract is enforced by TypeScript afterward. No per-render overhead, no dead branch in the hot path.

**i18n key cleanup**: `lang.toggle.invalid` is now unused. Delete from both `messages/en.ts` (line 76) and `messages/zh.ts` (line 76). Verify the symmetry test passes after removal (it should — the symmetry test compares the two tables, not what code references what).

## Change 5 — Reconcile spec/code ownership (FR5)

**File**: `.trellis/spec/i18n.md`, "Manual language override (08-23 ui-lang-toggle)" section.

Find the paragraph:
> The override is written by `LangStore` (`src/util/langStore.ts`) on every cycle/set, and cleared (`undefined`) when pref is `auto`.

Replace with:
> The override is written by `extension.ts`'s `onDidChangeConfiguration` listener (single channel; see `src/extension.ts` ~L408) on every `claudeTaskMonitor.language` config change, and cleared (`undefined`) when the new pref is `auto`. `LangStore` itself does not touch the override — it stays decoupled from the i18n layer so the store can be unit-tested without VS Code's i18n state.

Why this is the correct architecture (and not the other way around):
- `LangStore.ts:8-9` (08-25 rationale): "不持有 EventEmitter —— 事件由 onDidChangeConfiguration 单一通道驱动,避免双触发". Putting the override write in `LangStore.set()` would either:
  - (a) couple `LangStore` to `setLangOverride` (breaks the "decoupled from i18n" property), OR
  - (b) require a separate event/callback mechanism to push the write out (re-introduces the EventEmitter the comment explicitly rejects).
- The current architecture is correct. The spec was wrong; update it.

**File**: `src/util/langStore.ts:53-62` JSDoc

The current JSDoc on `currentLang()` already says:
> module override 在 set(zh/en) 时被 setLangOverride 写入,在 set(auto) 时必须清空 (由 extension.ts 的 config listener 处理)。

This is correct — it points at the listener as the writer. **No change needed in langStore.ts itself.** The fix is one-directional: update the spec to match what the code already does.

Wait — finding #5 said "the code comment says override is written by extension.ts's config listener". So the comment is actually fine; the spec is wrong. Confirmed: fix is spec-only.

But the 08-25 `implement.md` Step 9 said "spec wording is slightly inaccurate ... defer a spec polish as out-of-scope." This round-2 review surfaces it again, and we're now closing it. Single paragraph edit in `i18n.md`.

## Change 6 — Replace `:20` line cite with anchor (FR6)

**File**: `src/extension.ts:402-404`

Before:
```ts
// 'auto' 必须显式清空 override (08-25):LangStore.currentLang() 已对 'auto' 走
// detectEnvLang 独立工作,但 spec (.trellis/spec/i18n.md:20) 要求
// setLangOverride(undefined) 在 pref=auto 时落地 —— 让 t() 全局也回落到 env。
```

After:
```ts
// 'auto' 必须显式清空 override (08-25):LangStore.currentLang() 已对 'auto' 走
// detectEnvLang 独立工作,但 spec (spec/i18n.md#manual-language-override) 要求
// setLangOverride(undefined) 在 pref=auto 时落地 —— 让 t() 全局也回落到 env。
```

The anchor `#manual-language-override` is grep-stable (grep `## Manual language override` returns 1 hit) and survives section body reorders. The heading text was chosen by the spec author — preserving it as the anchor is a reasonable assumption.

Add a sibling change in FR5's spec edit to confirm the anchor exists. Section heading currently is `### Manual language override (08-23 ui-lang-toggle)`. Confirm after edit.

## Change 7 — Dedicated `LangToggle` test file (FR7)

**New file**: `src/test/langToggle.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LangToggle } from '../ui/langToggle.js'
import { type LangPref } from '../util/langStore.js'

// Mock vscode StatusBarItem
const mockItem = () => ({
  text: '',
  tooltip: undefined as string | undefined,
  command: undefined as string | undefined,
  name: undefined as string | undefined,
  show: vi.fn(),
  dispose: vi.fn(),
  alignment: 0,
  priority: 0,
})

describe('LangToggle (08-26)', () => {
  let item: ReturnType<typeof mockItem>

  beforeEach(() => {
    item = mockItem()
    // Stub vscode.window.createStatusBarItem to return our mock
    vi.mocked(vscode.window.createStatusBarItem).mockReturnValue(item as any)
  })

  it('render with auto: text = $(globe) A, tooltip mentions Auto', () => {
    const t = new LangToggle(() => 'auto')
    expect(item.text).toBe('$(globe) A')
    expect(item.tooltip).toContain('Auto')
  })

  it('render with zh: text = $(globe) 中, tooltip mentions Chinese → English', () => {
    const t = new LangToggle(() => 'zh')
    expect(item.text).toBe('$(globe) 中')
    expect(item.tooltip).toContain('Chinese')
    expect(item.tooltip).toContain('English')   // next = en
  })

  it('render with en: text = $(globe) EN, tooltip mentions English → Auto', () => {
    const t = new LangToggle(() => 'en')
    expect(item.text).toBe('$(globe) EN')
    expect(item.tooltip).toContain('English')
    expect(item.tooltip).toContain('Auto')      // next = auto
  })

  it('render reflects getter change (no internal caching)', () => {
    let pref: LangPref = 'auto'
    const t = new LangToggle(() => pref)
    t.render()                                  // initial
    expect(item.text).toBe('$(globe) A')

    pref = 'zh'
    t.render()
    expect(item.text).toBe('$(globe) 中')

    pref = 'en'
    t.render()
    expect(item.text).toBe('$(globe) EN')
  })

  it('tooltip uses i18n state names (zh mode)', () => {
    vi.mocked(t).mockReturnValueOnce('...')      // stub t() for deterministic output
    // ... or simpler: assert tooltip is a non-empty string and contains the
    // state markers. Don't over-test the i18n key contract — symmetry test
    // already covers that.
  })

  it('dispose disposes the underlying StatusBarItem', () => {
    const t = new LangToggle(() => 'auto')
    t.dispose()
    expect(item.dispose).toHaveBeenCalledTimes(1)
  })

  it('construction throws if getPref returns invalid value (defense shift, R1)', () => {
    expect(() => new LangToggle(() => 'fr' as unknown as LangPref)).toThrow(/LangToggle/)
  })
})
```

Wait — `t` is imported from `../i18n/index.js`. Don't mock it; just test the rendered text directly (it's a single line, easy to assert on) and verify the tooltip format by asserting on substrings. The symmetry test in `i18n.test.ts` covers the i18n key contract; this test covers the LangToggle layer's composition.

The test file should not need a `vscode` mock for the basic render path (we mock `vscode.window.createStatusBarItem` and pass through everything else). Reference the pattern in `statusBar.test.ts`.

## Test design

### New test files / additions

| File | New tests | Purpose |
|---|---|---|
| `src/test/langToggle.test.ts` | 6 tests | FR7: dedicated coverage for `LangToggle` |
| `src/test/extension.test.ts` (new) or extend existing | 8 tests | FR1: `formatToggleFailMessage` exhaustive coverage |
| `src/test/i18n.test.ts` | 0 new tests | FR2: existing tests still pass with refactored helper |
| `src/test/i18n.test.ts` | 1 new test | FR3: after activation pattern, `setLangOverride(undefined)` for `auto` → `detectLang()` returns env |

### Where to put the format helper test

The cleanest path is a new tiny module `src/util/formatError.ts` (per Change 1) and a corresponding `src/test/formatError.test.ts`. This:
- Makes the helper importable from both `extension.ts` and the test file (no internal-export gymnastics).
- Avoids creating a brand-new `extension.test.ts` (which would need to mock a lot of `extension.ts`'s top-level side effects).
- Follows the existing pattern of one-purpose util files (`util/langStore.ts`, `util/test.ts`).

If the user prefers fewer new files, the alternative is to inline the helper in `extension.ts` and write the test as an integration test against the compiled output. **Recommend the `src/util/formatError.ts` approach.**

## Compatibility

- No public API removal. `detectLang`, `detectEnvLang`, `setLangOverride`, `LangStore.{get,set,cycle,syncFromConfig,currentLang}`, `isLangPref`, `LangToggle.{constructor,render,dispose}` all unchanged in signature.
- Internal helpers may change: `fromEnv()` (new private in `i18n/index.ts`), `formatToggleFailMessage` (new in `src/util/formatError.ts`).
- i18n key `lang.toggle.invalid` is removed from `messages/{en,zh}.ts`. This is a breaking change for any external consumer reading these files, but they are internal `messages/` modules — no external consumer exists.
- Spec paragraph rewritten (semantic correction, not structural change). Spec index unaffected.

## Rollback

Single commit (likely), touching:
- `src/extension.ts` — small edits at L80, L330, L402-404, plus `formatToggleFailMessage` import.
- `src/i18n/index.ts` — extract `fromEnv()`, update header comment.
- `src/ui/langToggle.ts` — delete guard, add constructor check.
- `src/util/formatError.ts` — new file.
- `src/i18n/messages/{en,zh}.ts` — delete `lang.toggle.invalid`.
- `.trellis/spec/i18n.md` — one paragraph edit.
- `src/test/langToggle.test.ts` — new file.
- `src/test/formatError.test.ts` — new file.
- `src/test/i18n.test.ts` — possibly one new test (FR3).

`git revert <commit>` recovers all of the above. No data migration. No config schema change.
