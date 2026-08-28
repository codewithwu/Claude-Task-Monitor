// 格式化 unknown 异常值为安全字符串,用于 toast 文案 / 用户可见的日志。
//
// 为什么需要 helper (08-27 扩到全 codebase,08-28 加 duck-typed .message 分支):
//   - workspace.getConfiguration().update() / watcher.onDidChange / muted push 等
//     在受限 profile / schema 校验失败 / 文件 IO 异常时可能 reject null/undefined、
//     非 Error 对象、或 { message: string } 形式的 plain object (包装库行为)。
//     直接 .message 会让错误处理本身抛 TypeError,用户反而看不到 toast。
//   - 三段优先级:
//       1. e instanceof Error → e.message || String(e) (空 message 兜底 "Error")
//       2. duck-typed { message: string } → e.message (08-28 加;受限 profile 下
//          vscode.workspace.getConfiguration().update() 的常见 reject 形态)
//       3. String(e) 兜底 (null → "null", undefined → "undefined",
//          object → "[object Object]")。第 2 步用 typeof message === 'string'
//          严格守卫,{ message: null } / { message: 42 } 等仍走第 3 步。
//   - 关键:每一段都保证 t() 拿到非空字符串,避免模板占位符 {0} 或 ": " 之类的
//     空 message 泄露给用户。
//
// 单独抽到 util 模块而不是内联在 extension.ts,便于在 langToggle.test.ts 等
// 测试文件里直接 import 覆盖(extension.ts 顶层副作用太多,不适合做单测入口)。
// extension.ts / muted.ts / watcher.ts 的所有 catch 块都走这里。

export function formatErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || String(e)
  if (
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    typeof (e as { message: unknown }).message === 'string'
  ) {
    return (e as { message: string }).message
  }
  return String(e)
}