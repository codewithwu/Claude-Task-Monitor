// 纯函数:从 session 列表算出 status bar 文案 + tooltip。
// 拆出来便于单测,StatusBar 类只负责 vscode 装配 (避免测试 import vscode 模块)。

export interface StatusBarContent {
  text: string
  tooltip: string
}

export function computeStatusBarContent(sessions: ReadonlyArray<{ status: string }>): StatusBarContent {
  const total = sessions.length
  const waiting = sessions.filter(s => s.status === 'waiting').length

  if (waiting === 0) {
    return {
      text: '$(pulse) CTM',
      tooltip: `Claude Task Monitor · ${total} sessions active`
    }
  }
  return {
    text: `$(pulse) CTM: ${waiting}⚠`,  // ⚠
    tooltip: `${waiting} 个会话正在等待权限确认`
  }
}