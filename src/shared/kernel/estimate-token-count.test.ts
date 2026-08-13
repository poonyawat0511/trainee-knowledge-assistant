import { describe, it, expect } from 'vitest'
import { estimateTokenCount } from './estimate-token-count'

describe('estimateTokenCount', () => {
  it('estimates roughly one token per 4 characters, rounded up', () => {
    expect(estimateTokenCount('hi')).toBe(1)
    expect(estimateTokenCount('a'.repeat(8))).toBe(2)
    expect(estimateTokenCount('a'.repeat(9))).toBe(3)
  })

  it('returns 0 for an empty string', () => {
    expect(estimateTokenCount('')).toBe(0)
  })
})
