/** Byte-bounded LRU. An entry larger than the whole budget is never cached. */
export class ByteLru<V> {
  private readonly map = new Map<string, { value: V; cost: number }>();
  private used = 0;

  constructor(private budget: number) {}

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    this.map.delete(key);
    this.map.set(key, e); // most recently used goes last
    return e.value;
  }

  set(key: string, value: V, cost: number): void {
    const old = this.map.get(key);
    if (old) {
      this.used -= old.cost;
      this.map.delete(key);
    }
    if (cost > this.budget) return;
    this.map.set(key, { value, cost });
    this.used += cost;
    while (this.used > this.budget) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.used -= this.map.get(oldest)!.cost;
      this.map.delete(oldest);
    }
  }

  setBudget(bytes: number): void {
    this.budget = bytes;
    this.set("", undefined as never, Number.POSITIVE_INFINITY); // evicts via the loop below
    this.map.delete("");
    while (this.used > this.budget) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.used -= this.map.get(oldest)!.cost;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
  get bytes(): number {
    return this.used;
  }
  clear(): void {
    this.map.clear();
    this.used = 0;
  }
}
