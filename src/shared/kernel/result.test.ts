import { describe, it, expect } from 'vitest'
import { ok, err, isOk } from './result'

describe('Result', () => {
  it('wraps a success value', () => {
    const r = ok(42)
    expect(isOk(r)).toBe(true)
    if (isOk(r)) expect(r.value).toBe(42)
  })

  it('wraps an error value', () => {
    const r = err('BAD_INPUT')
    expect(isOk(r)).toBe(false)
    if (!isOk(r)) expect(r.error).toBe('BAD_INPUT')
  })
})
