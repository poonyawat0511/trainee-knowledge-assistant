import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { TokenBucketLimiter } from "./token-bucket"

describe("TokenBucketLimiter", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("allows requests up to the limit then blocks", () => {
    const limiter = new TokenBucketLimiter({ maxRequests: 2, windowMs: 60_000 })
    expect(limiter.tryConsume("user-1").allowed).toBe(true)
    expect(limiter.tryConsume("user-1").allowed).toBe(true)
    const third = limiter.tryConsume("user-1")
    expect(third.allowed).toBe(false)
    expect(third.retryAfterSeconds).toBeGreaterThan(0)
  })

  it("tracks separate buckets per key", () => {
    const limiter = new TokenBucketLimiter({ maxRequests: 1, windowMs: 60_000 })
    expect(limiter.tryConsume("user-1").allowed).toBe(true)
    expect(limiter.tryConsume("user-2").allowed).toBe(true)
  })

  it("resets after the window passes", () => {
    const limiter = new TokenBucketLimiter({ maxRequests: 1, windowMs: 60_000 })
    expect(limiter.tryConsume("user-1").allowed).toBe(true)
    vi.advanceTimersByTime(61_000)
    expect(limiter.tryConsume("user-1").allowed).toBe(true)
  })
})
