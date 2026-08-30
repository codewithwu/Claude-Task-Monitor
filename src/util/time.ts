export function humanizeDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return s === 0 ? `${m}m` : `${m}m ${s}s`
  }
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

// 单一时间源 —— 整个 refresh tick 共用同一秒数,避免每个 site 各算各的
// 漂移导致 elapsed 显示负值或不一致。
export function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

// 从 stateChangedAt 算 elapsed seconds,夹到 ≥ 0(stateChangedAt 在未来时
// clock skew 兜底)。caller 可以注入 nowSec 让一个 tick 内复用。
export function elapsedSince(stateChangedAt: number, nowSecValue: number = nowSec()): number {
  return Math.max(0, nowSecValue - stateChangedAt)
}
