import { describe, it, expect } from 'vitest'
import { formatErrorMessage } from '../util/formatError.js'

describe('formatErrorMessage (08-27)', () => {
  it.each<[unknown, string]>([
    [new Error('boom'), 'boom'],
    [new TypeError('bad type'), 'bad type'],
    [new Error(), 'Error'],                          // 08-27 FR3:?? → ||,default message '' 落到 String(e)='Error'
    [{ message: 'string-coerced' }, 'string-coerced'],  // 08-28 F1: duck-typed .message 分支 (typeof message === 'string' 通过)
    [{ message: '' }, '[object Object]'],              // 08-29 R1: duck-typed 空串兜底,与 Error 分支对齐
    [{ message: null }, '[object Object]'],
    [{ message: undefined }, '[object Object]'],
    ['string-reject', 'string-reject'],
    [null, 'null'],
    [undefined, 'undefined'],
    [42, '42'],
    [true, 'true'],
  ])('formats %p → %p', (input, expected) => {
    expect(formatErrorMessage(input)).toBe(expected)
  })

  it('never returns the literal {0} template placeholder', () => {
    expect(formatErrorMessage(new Error())).not.toContain('{0}')
    expect(formatErrorMessage({ message: null })).not.toContain('{0}')
    expect(formatErrorMessage(undefined)).not.toContain('{0}')
    expect(formatErrorMessage(null)).not.toContain('{0}')
  })

  it('returns "Error" for new Error() with default empty message (08-27, FR3)', () => {
    expect(formatErrorMessage(new Error())).toBe('Error')
  })

  it('handles Error subclass with undefined message', () => {
    class CustomError extends Error {
      constructor() {
        super()
        this.message = undefined as unknown as string
      }
    }
    expect(formatErrorMessage(new CustomError())).toBe('Error')
  })
})