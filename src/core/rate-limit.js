export class RateLimiter {
  constructor({ windowMs = 60_000, max = 120, now = () => Date.now() } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.now = now;
    this.windows = new Map();
  }

  consume(key) {
    const current = this.now();
    let bucket = this.windows.get(key);
    if (!bucket || current >= bucket.resetAt) {
      bucket = { count: 0, resetAt: current + this.windowMs };
      this.windows.set(key, bucket);
    }
    bucket.count += 1;
    const allowed = bucket.count <= this.max;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - current) / 1000),
    );
    if (this.windows.size > 10_000) {
      for (const [entryKey, entry] of this.windows) {
        if (current >= entry.resetAt) this.windows.delete(entryKey);
      }
    }
    return { allowed, retryAfterSeconds, count: bucket.count, limit: this.max };
  }
}
