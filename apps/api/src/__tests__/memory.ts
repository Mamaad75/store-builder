import { randomUUID } from "node:crypto";
import type { RateLimitResult, RateLimitRule, RateLimiter, UserRecord, UserRepository } from "../auth/ports.js";

export class MemoryUsers implements UserRepository {
  readonly rows = new Map<string, UserRecord>();
  async create(data: { name: string; username: string; passwordHash: string }) {
    if ([...this.rows.values()].some((u) => u.username === data.username)) return null;
    const row: UserRecord = { id: randomUUID(), authVersion: 0, ...data };
    this.rows.set(row.id, row);
    return row;
  }
  async findByUsername(username: string) {
    return [...this.rows.values()].find((u) => u.username === username) ?? null;
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async setPassword(id: string, passwordHash: string) {
    const u = this.rows.get(id)!;
    this.rows.set(id, { ...u, passwordHash, authVersion: u.authVersion + 1 });
  }
  async bumpAuthVersion(id: string) {
    const u = this.rows.get(id)!;
    this.rows.set(id, { ...u, authVersion: u.authVersion + 1 });
  }
}

export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(private now: () => number = Date.now) {}
  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= t) {
      b = { count: 0, resetAt: t + rule.windowSeconds * 1000 };
      this.buckets.set(key, b);
    }
    b.count += 1;
    return { allowed: b.count <= rule.limit, remaining: Math.max(0, rule.limit - b.count), retryAfterSeconds: Math.max(1, Math.ceil((b.resetAt - t) / 1000)) };
  }
}
