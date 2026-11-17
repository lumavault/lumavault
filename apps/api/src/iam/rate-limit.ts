/**
 * A fixed-window counter kept in memory. Each API process limits on its own, which is
 * enough for one server; a shared store would be needed to run several.
 */
export class RateLimiter {
  readonly #hits = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one hit for key, returning false once the key is over its limit for this window. */
  allow(key: string): boolean {
    const t = this.now();
    const entry = this.#hits.get(key);
    if (!entry || t - entry.windowStart >= this.windowMs) {
      this.#prune(t);
      this.#hits.set(key, { count: 1, windowStart: t });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  #prune(t: number): void {
    for (const [key, entry] of this.#hits) {
      if (t - entry.windowStart >= this.windowMs) this.#hits.delete(key);
    }
  }
}
