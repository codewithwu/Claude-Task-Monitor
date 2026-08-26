import { describe, it, expect } from 'vitest'
import { formatToggleFailMessage } from '../util/formatError.js'

describe('formatToggleFailMessage (08-26)', () => {
  it.each<[unknown, string]>([
    [new Error('boom'), 'boom'],
    [new TypeError('bad type'), 'bad type'],
    [new Error(), ''],                              // default message → '' (e.message === '')
    [{ message: 'string-coerced' }, '[object Object]'], // non-Error with message: instanceof false → String(e)
    [{ message: null }, '[object Object]'],
    [{ message: undefined }, '[object Object]'],
    ['string-reject', 'string-reject'],
    [null, 'null'],
    [undefined, 'undefined'],
    [42, '42'],
    [true, 'true'],
  ])('formats %p → %p', (input, expected) => {
    expect(formatToggleFailMessage(input)).toBe(expected)
  })

  it('never returns the literal {0} template placeholder', () => {
    expect(formatToggleFailMessage(new Error())).not.toContain('{0}')
    expect(formatToggleFailMessage({ message: null })).not.toContain('{0}')
    expect(formatToggleFailMessage(undefined)).not.toContain('{0}')
    expect(formatToggleFailMessage(null)).not.toContain('{0}')
  })

  it('handles Error subclass with undefined message', () => {
    class CustomError extends Error {
      constructor() {
        super()
        this.message = undefined as unknown as string
      }
    }
    expect(formatToggleFailMessage(new CustomError())).toBe('Error')
  })
})
