interface Bucket {
  count: number
  windowStart: number
}

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>()
  private readonly maxRequests: number
  private readonly windowMs: number

  constructor(options: { maxRequests: number; windowMs: number }) {
    this.maxRequests = options.maxRequests
    this.windowMs = options.windowMs
  }

  tryConsume(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now()
    const bucket = this.buckets.get(key)

    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: now })
      return { allowed: true, retryAfterSeconds: 0 }
    }

    if (bucket.count < this.maxRequests) {
      bucket.count += 1
      return { allowed: true, retryAfterSeconds: 0 }
    }

    const retryAfterSeconds = Math.ceil((bucket.windowStart + this.windowMs - now) / 1000)
    return { allowed: false, retryAfterSeconds }
  }
}

// Module-level singleton so both chat routes share the same limiter state
export const chatRateLimiter = new TokenBucketLimiter({ maxRequests: 10, windowMs: 60_000 })
