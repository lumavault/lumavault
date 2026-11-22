/**
 * A fixed-window counter kept in memory. Each API process limits on its own, which is
 * enough for one server; several servers would need a shared store.
 */
export class RateLimiter {
  readonly #hits = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one hit for key and reports whether the key is still within its limit. */
  allow(key: string): boolean {
    const t = this.now();
    const entry = this.#hits.get(key);
    if (!entry || t - entry.windowStart >= this.windowMs) {
      this.#prune(t);
      this.#hits.set(key, { count: 1, windowStart: t });
      return this.limit >= 1;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  // Dropping finished windows whenever a new one opens keeps memory bounded by active keys.
  #prune(t: number): void {
    for (const [key, entry] of this.#hits) {
      if (t - entry.windowStart >= this.windowMs) {
        this.#hits.delete(key);
      }
    }
  }
}
