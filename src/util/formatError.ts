// 格式化 unknown 异常值为安全字符串,用于 toast 文案 / 用户可见的日志。
//
// 为什么需要 helper (08-27 扩到全 codebase):
//   - workspace.getConfiguration().update() / watcher.onDidChange / muted push 等
//     在受限 profile / schema 校验失败 / 文件 IO 异常时可能 reject null/undefined
//     或非 Error 对象 (包装库行为),直接 .message 会让错误处理本身抛 TypeError,
//     用户反而看不到 toast。
//   - e instanceof Error 时:e.message 是 string | undefined (自定义 Error 子类
//     可能不赋值);空字符串/未赋值时 String(e) 兜底 (Error 默认 toString 是
//     "Error")。
//   - 非 Error 时:String(e) 把任意 unknown 安全转字符串 (null → "null",
//     undefined → "undefined", object → "[object Object]")。
//   - 关键:两条分支都走 String() 兜底,保证 t() 拿到非空字符串,避免
//     模板占位符 {0} 或 ": " 之类的空 message 泄露给用户。
//
// 单独抽到 util 模块而不是内联在 extension.ts,便于在 langToggle.test.ts 等
// 测试文件里直接 import 覆盖(extension.ts 顶层副作用太多,不适合做单测入口)。
// extension.ts / muted.ts / watcher.ts 的所有 catch 块都走这里。

export function formatErrorMessage(e: unknown): string {
  return e instanceof Error ? (e.message || String(e)) : String(e)
}