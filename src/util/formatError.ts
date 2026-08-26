// 格式化 toggleLanguage 命令的 reject 值,用于 toast 文案。
//
// 为什么需要 helper:
//   - workspace.getConfiguration().update() 在受限 profile / schema 校验失败时
//     可能 reject null/undefined 或非 Error 对象 (包装库行为),直接 .message 会
//     让错误处理本身抛 TypeError,用户反而看不到 toast。
//   - e instanceof Error 时:e.message 是 string | undefined (自定义 Error 子类可能
//     不赋值);null/undefined 时 String(e) 兜底 (Error 默认 toString 是 "Error")。
//   - 非 Error 时:String(e) 把任意 unknown 安全转字符串 (null → "null",
//     undefined → "undefined", object → "[object Object]")。
//   - 关键:两条分支都走 String() 兜底,保证 t() 拿到非 undefined,避免
//     模板占位符 {0} 泄露给用户。
//
// 单独抽到 util 模块而不是内联在 extension.ts,便于在 langToggle.test.ts 等
// 测试文件里直接 import 覆盖(extension.ts 顶层副作用太多,不适合做单测入口)。

export function formatToggleFailMessage(e: unknown): string {
  return e instanceof Error ? (e.message ?? String(e)) : String(e)
}
