// cwd → 项目名(供 sidebar / tooltip / status bar / 通知复用):
//   - 取最后一段路径组件作为可读名
//   - Windows 路径用 \ 分隔,先归一为 / 再用 posix.basename,
//     避免原生 Windows cwd (`C:\Users\me\proj`) 在 posix basename 上返回整段
//   - basename 为空(根路径 / 或空串)时 fallback 到原 cwd

import { posix as pathPosix } from 'node:path'

export function projectName(cwd: string): string {
  return pathPosix.basename(cwd.replace(/\\/g, '/')) || cwd
}