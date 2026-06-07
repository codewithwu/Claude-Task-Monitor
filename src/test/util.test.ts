import { describe, it, expect } from 'vitest'
import { humanizeDuration } from '../util/time'

describe('humanizeDuration', () => {
  it.each([
    [0, '0s'],
    [5, '5s'],
    [59, '59s'],
    [60, '1m'],
    [125, '2m 5s'],
    [3600, '1h'],
    [3725, '1h 2m'],
    [86400, '24h']
  ])('seconds=%i -> %s', (sec, expected) => {
    expect(humanizeDuration(sec)).toBe(expected)
  })
})
