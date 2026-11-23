import { describe, expect, it } from "vitest";
import { OtpDeliveryError, OtpInvalidError, OtpRateLimitedError, OtpUnavailableError } from "@store-builder/shared/modules/customers/errors";
import { CustomerExistsError, CustomerLoginError } from "@store-builder/shared/modules/customers/errors";
import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import { OTP } from "../domain/otp.js";
import { CustomerAuthService } from "./customer-auth.service.js";
import { CustomersService } from "./customers.service.js";
import type { ChallengeRow, CustomerClaims, CustomerView, OtpSender } from "./ports.js";

/** In-memory ports with the same contracts as the PostgreSQL ones (atomic attempt counting, compare-and-set consume). */
function world(o: { sender?: OtpSender | null; failSend?: boolean } = {}) {
  let t = new Date("2026-03-01T10:00:00Z").getTime();
  const now = () => new Date(t);
  const sent: { phone: string; code: string }[] = [];
  const challenges: (ChallengeRow & { storeId: string; phone: string })[] = [];
  const customers: CustomerView[] = [];
  const hashes = new Map<string, string>();
  const buckets = new Map<string, number>();
  let n = 0;
  let codeSeq = 111111;
  const sender: OtpSender = {
    async sendOtp(phone, code) {
      if (o.failSend) throw new Error("provider said no");
      sent.push({ phone, code });
    },
  };
  const svc = new CustomerAuthService({
    sender: async () => (o.sender === undefined ? sender : o.sender),
    passwords: { hash: async (p) => `h:${p}`, verify: async (h, p) => h === `h:${p}`, verifyDummy: async () => false },
    now,
    codec: { newCode: () => String(codeSeq++), hash: (s, p, c) => `h(${s}|${p}|${c})`, same: (a, b) => a === b },
    limiter: {
      async consume(key, rule) {
        const used = (buckets.get(key) ?? 0) + 1;
        buckets.set(key, used);
        return { allowed: used <= rule.limit, retryAfterSeconds: 3600 };
      },
    },
    tokens: {
      issue: async (c: CustomerClaims) => `tok:${c.customerId}:${c.storeId}:${c.authVersion}`,
      read: async (tk) => {
        const [, customerId, storeId, av] = tk.split(":");
        return tk.startsWith("tok:") ? { customerId: customerId!, storeId: storeId!, authVersion: Number(av) } : null;
      },
    },
    otps: {
      latest: async (s, p) => challenges.filter((c) => c.storeId === s && c.phone === p).at(-1) ?? null,
      create: async (storeId, phone, codeHash, expiresAt) => {
        const id = `c${++n}`;
        challenges.push({ id, storeId, phone, codeHash, expiresAt, attempts: 0, createdAt: now(), consumedAt: null });
        return id;
      },
      countAttempt: async (id, max) => {
        const c = challenges.find((x) => x.id === id)!;
        if (c.consumedAt || c.attempts >= max) return false;
        c.attempts++;
        return true;
      },
      consume: async (id, at) => {
        const c = challenges.find((x) => x.id === id)!;
        if (c.consumedAt) return false;
        c.consumedAt = at;
        return true;
      },
      discard: async (id) => void challenges.splice(challenges.findIndex((x) => x.id === id), 1),
    },
    customers: {
      signIn: async (storeId, phone, at) => {
        let c = customers.find((x) => x.storeId === storeId && x.phone === phone);
        if (!c) customers.push((c = { id: `u${customers.length + 1}`, storeId, phone, name: null, authVersion: 0, phoneVerifiedAt: null, lastLoginAt: null, createdAt: at }));
        if (c.phoneVerifiedAt === null && hashes.has(c.id)) {
          hashes.delete(c.id);
          c.authVersion++;
        }
        c.phoneVerifiedAt ??= at;
        c.lastLoginAt = at;
        return { ...c };
      },
      credentials: async (s, phone) => {
        const c = customers.find((x) => x.storeId === s && x.phone === phone);
        return c ? { customer: { ...c }, passwordHash: hashes.get(c.id) ?? null } : null;
      },
      register: async (storeId, phone, name, hash, at) => {
        let c = customers.find((x) => x.storeId === storeId && x.phone === phone);
        if (c && (hashes.has(c.id) || c.phoneVerifiedAt)) return "exists";
        if (!c) customers.push((c = { id: `u${customers.length + 1}`, storeId, phone, name, authVersion: 0, phoneVerifiedAt: null, lastLoginAt: at, createdAt: at }));
        c.name = name;
        hashes.set(c.id, hash);
        return { ...c };
      },
      recordLogin: async (s, id, at) => void customers.filter((x) => x.storeId === s && x.id === id).forEach((x) => (x.lastLoginAt = at)),
      find: async (s, id) => customers.find((x) => x.storeId === s && x.id === id) ?? null,
      list: async (s, q) => customers.filter((x) => x.storeId === s && (!q.before || x.createdAt < q.before)).slice(0, q.limit),
      bumpAuthVersion: async (s, id) => void customers.filter((x) => x.storeId === s && x.id === id).forEach((x) => x.authVersion++),
    },
  });
  return { svc, sent, challenges, customers, hashes, tick: (ms: number) => (t += ms) };
}
const IP = "10.0.0.1";

describe("customer sign-in by SMS code (phase 3.1)", () => {
  it("is OFF without an SMS sender: both steps refuse and nothing is stored", async () => {
    const w = world({ sender: null });
    expect(await w.svc.isEnabled()).toBe(false);
    await expect(w.svc.requestCode("s1", "09123456789", IP)).rejects.toBeInstanceOf(OtpUnavailableError);
    await expect(w.svc.verifyCode("s1", "09123456789", "111111", IP)).rejects.toBeInstanceOf(OtpUnavailableError);
    expect(w.challenges).toEqual([]);
  });

  it("sends a code to the normalised number, then signs in (account created once, per store)", async () => {
    const w = world();
    expect(await w.svc.requestCode("s1", "۰۹۱۲ ۳۴۵ ۶۷۸۹", IP)).toEqual({ resendAfterSeconds: OTP.resendSeconds, expiresInSeconds: OTP.ttlSeconds });
    expect(w.sent).toEqual([{ phone: "+989123456789", code: "111111" }]);
    expect(w.challenges[0]!.codeHash).not.toContain("111111x");
    const r = await w.svc.verifyCode("s1", "+989123456789", "111111", IP);
    expect(r.customer).toEqual({ id: "u1", phone: "+989123456789", name: null, phoneVerified: true });
    expect(await w.svc.current("s1", r.token)).toEqual(r.customer);
    expect(await w.svc.current("s2", r.token)).toBeNull(); // a session is valid for its own store only
    w.tick(61_000);
    await w.svc.requestCode("s2", "09123456789", IP);
    await w.svc.verifyCode("s2", "09123456789", "111112", IP);
    expect(w.customers.map((c) => `${c.storeId}:${c.id}`)).toEqual(["s1:u1", "s2:u2"]); // separate accounts per store
  });

  it("a code is single-use, expires after two minutes, and five wrong tries burn it even for the right code", async () => {
    const w = world();
    await w.svc.requestCode("s1", "09123456789", IP);
    await w.svc.verifyCode("s1", "09123456789", "111111", IP);
    await expect(w.svc.verifyCode("s1", "09123456789", "111111", IP)).rejects.toBeInstanceOf(OtpInvalidError); // used

    w.tick(61_000);
    await w.svc.requestCode("s1", "09123456789", IP); // 111112
    w.tick(OTP.ttlSeconds * 1000);
    await expect(w.svc.verifyCode("s1", "09123456789", "111112", IP)).rejects.toBeInstanceOf(OtpInvalidError); // expired

    await w.svc.requestCode("s1", "09123456789", IP); // 111113
    for (let i = 0; i < OTP.maxAttempts; i++) await expect(w.svc.verifyCode("s1", "09123456789", "000000", IP)).rejects.toBeInstanceOf(OtpInvalidError);
    await expect(w.svc.verifyCode("s1", "09123456789", "111113", IP)).rejects.toBeInstanceOf(OtpInvalidError); // exhausted
  });

  it("the same answer for an unknown phone, a malformed code and a wrong code (no account enumeration)", async () => {
    const w = world();
    for (const [phone, code] of [["09120000000", "123456"], ["09123456789", "12"], ["bad", "123456"]] as const)
      await expect(w.svc.verifyCode("s1", phone, code, IP)).rejects.toBeInstanceOf(OtpInvalidError);
  });

  it("limits: one code a minute per phone, an hourly cap per phone and per IP; an invalid phone is a field error", async () => {
    const w = world();
    await expect(w.svc.requestCode("s1", "02112345678", IP)).rejects.toBeInstanceOf(ValidationError);
    await w.svc.requestCode("s1", "09123456789", IP);
    const e = await w.svc.requestCode("s1", "09123456789", IP).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(OtpRateLimitedError);
    expect((e as OtpRateLimitedError).retryAfterSeconds).toBe(60);
    for (let i = 1; i < OTP.perPhonePerHour.limit; i++) {
      w.tick(61_000);
      await w.svc.requestCode("s1", "09123456789", IP);
    }
    w.tick(61_000);
    await expect(w.svc.requestCode("s1", "09123456789", IP)).rejects.toBeInstanceOf(OtpRateLimitedError);
  });

  it("security review 2026-11-23: one phone is capped across ALL stores, not just per store", async () => {
    const w = world();
    let sentFor = 0;
    for (let s = 1; s <= 12; s++) {
      const r = await w.svc.requestCode(`s${s}`, "09123456789", `10.0.0.${s}`).then(() => "ok", (e: unknown) => e);
      if (r === "ok") sentFor++;
      else expect(r).toBeInstanceOf(OtpRateLimitedError);
    }
    expect(sentFor).toBe(OTP.perPhoneAllStoresPerHour.limit);
  });

  it("a code the provider refused is discarded (the shopper can retry at once) and the provider's message never surfaces", async () => {
    const w = world({ failSend: true });
    const e = await w.svc.requestCode("s1", "09123456789", IP).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(OtpDeliveryError);
    expect(String((e as Error).message)).not.toContain("provider");
    expect(w.challenges).toEqual([]);
  });

  it("signing out everywhere ends every session of the customer", async () => {
    const w = world();
    await w.svc.requestCode("s1", "09123456789", IP);
    const { token } = await w.svc.verifyCode("s1", "09123456789", "111111", IP);
    await w.svc.signOutEverywhere("s1", token);
    expect(await w.svc.current("s1", token)).toBeNull();
  });
});

describe("the merchant's customer list (phase 3.1)", () => {
  it("validates paging and returns no internal fields", async () => {
    const w = world();
    await w.svc.requestCode("s1", "09123456789", IP);
    await w.svc.verifyCode("s1", "09123456789", "111111", IP);
    const list = new CustomersService({ list: async () => w.customers, signIn: async () => w.customers[0]!, find: async () => null, bumpAuthVersion: async () => undefined, credentials: async () => null, register: async () => "exists", recordLogin: async () => undefined });
    const rows = await list.list({ storeId: "s1" }, {});
    expect(Object.keys(rows[0]!)).not.toContain("authVersion");
    for (const bad of [{ limit: "0" }, { limit: "abc" }, { before: "not a date" }]) await expect(list.list({ storeId: "s1" }, bad)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("password accounts (phase 3.3b)", () => {
  const reg = { phone: "09121234567", name: " مریم  احمدی ", password: "secret-pass-1" };

  it("registers, signs in with phone and password, and is NOT phone-verified", async () => {
    const w = world();
    const r = await w.svc.register("s1", reg, IP);
    expect(r.customer).toMatchObject({ phone: "+989121234567", name: "مریم احمدی", phoneVerified: false });
    expect(r.token).toMatch(/^tok:/);
    expect((await w.svc.login("s1", { phone: "۰۹۱۲۱۲۳۴۵۶۷", password: "secret-pass-1" }, IP)).customer.id).toBe(r.customer.id);
  });

  it("one answer for wrong password, unknown phone and garbage", async () => {
    const w = world();
    await w.svc.register("s1", reg, IP);
    for (const body of [{ phone: reg.phone, password: "wrong-pass" }, { phone: "09120000000", password: "secret-pass-1" }, { phone: "x", password: "y" }, {}]) {
      await expect(w.svc.login("s1", body, IP)).rejects.toBeInstanceOf(CustomerLoginError);
    }
    await expect(w.svc.login("s2", { phone: reg.phone, password: "secret-pass-1" }, IP)).rejects.toBeInstanceOf(CustomerLoginError); // another store
  });

  it("a phone that already has a password, or was verified by SMS, cannot be registered again (no takeover)", async () => {
    const w = world();
    await w.svc.register("s1", reg, IP);
    await expect(w.svc.register("s1", { ...reg, password: "other-pass-2" }, IP)).rejects.toBeInstanceOf(CustomerExistsError);
    await w.svc.requestCode("s1", "09125550000", IP);
    await w.svc.verifyCode("s1", "09125550000", "111111", IP);
    await expect(w.svc.register("s1", { ...reg, phone: "09125550000" }, IP)).rejects.toBeInstanceOf(CustomerExistsError);
    await expect(w.svc.register("s1", { ...reg, password: "short" }, IP)).rejects.toBeInstanceOf(ValidationError);
  });

  it("the first SMS verification drops a password nobody proved owning the phone for, and ends its sessions", async () => {
    const w = world();
    const squatter = await w.svc.register("s1", reg, IP); // someone typed a phone that is not theirs
    await w.svc.requestCode("s1", reg.phone, IP);
    const owner = await w.svc.verifyCode("s1", reg.phone, "111111", IP);
    expect(owner.customer).toMatchObject({ id: squatter.customer.id, phoneVerified: true });
    expect(await w.svc.current("s1", squatter.token)).toBeNull();
    await expect(w.svc.login("s1", { phone: reg.phone, password: reg.password }, IP)).rejects.toBeInstanceOf(CustomerLoginError);
  });
});
