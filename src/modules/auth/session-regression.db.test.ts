import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { handlers } from "@/auth";
import { prisma, resetDb } from "@/test/db-helpers";
import { invalidateUserSessions, registerUser } from "./service";
import { MemoryRateLimiter } from "./rate-limit";

/**
 * Regression tests against the REAL Auth.js handler of the pinned version (no mocks):
 * they prove that the jwt callback runs when the session is read and that returning null
 * revokes the session and clears the cookie. If an Auth.js upgrade changes this behaviour,
 * these tests fail.
 */

const COOKIE = "authjs.session-token"; // http (non-secure) cookie name; also the JWT salt
const SECRET = process.env.AUTH_SECRET!;

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

async function createUserAndToken(authVersion?: number, maxAge = 3600) {
  await registerUser({ name: "Ali", email: "ali@example.com", password: "password123" }, { ip: "1.1.1.1", limiter: new MemoryRateLimiter() });
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "ali@example.com" } });
  const jwt = await encode({
    token: { sub: user.id, name: user.name, email: user.email, authVersion: authVersion ?? user.authVersion },
    secret: SECRET,
    salt: COOKIE,
    maxAge,
  });
  return { user, jwt };
}

async function readSession(jwt: string | null) {
  const req = new NextRequest("http://localhost:3000/api/auth/session", {
    headers: jwt ? { cookie: `${COOKIE}=${jwt}` } : {},
  });
  const res = await handlers.GET(req);
  const body = await res.json();
  const setCookie = res.headers.getSetCookie().join("\n");
  return { status: res.status, body, setCookie };
}

describe("pinned Auth.js version", () => {
  it("is pinned exactly (no range) and installed as pinned", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.dependencies["next-auth"]).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
    const installed = createRequire(import.meta.url)("next-auth/package.json").version;
    expect(installed).toBe(pkg.dependencies["next-auth"]);
  });
});

describe("session endpoint with the real Auth.js handler", () => {
  it("returns the session for a valid, current token, without sensitive fields", async () => {
    const { user, jwt } = await createUserAndToken();
    const { status, body, setCookie } = await readSession(jwt);
    expect(status).toBe(200);
    expect(body.user).toMatchObject({ id: user.id, email: "ali@example.com", name: "Ali" });
    expect(JSON.stringify(body)).not.toMatch(/argon2|passwordHash|authVersion/);
    expect(setCookie).toContain(COOKIE); // sliding refresh re-issues the cookie
  });

  it("returns no session when there is no cookie", async () => {
    const { body } = await readSession(null);
    expect(body).toBeNull();
  });

  it("revokes an existing JWT after authVersion is bumped and clears the cookie", async () => {
    const { user, jwt } = await createUserAndToken();
    expect((await readSession(jwt)).body?.user?.id).toBe(user.id);

    await invalidateUserSessions(user.id);

    const after = await readSession(jwt);
    expect(after.body).toBeNull();
    expect(after.setCookie).toMatch(new RegExp(`${COOKIE}=;`)); // cleared (empty value)
    expect(after.setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });

  it("accepts a token minted with the new authVersion after the bump", async () => {
    const { user } = await createUserAndToken();
    await invalidateUserSessions(user.id);
    const fresh = await encode({ token: { sub: user.id, authVersion: 1 }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
    expect((await readSession(fresh)).body?.user?.id).toBe(user.id);
  });

  it("rejects tokens for deleted users, with wrong authVersion type, or without authVersion", async () => {
    const { user } = await createUserAndToken();
    const noVersion = await encode({ token: { sub: user.id }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
    expect((await readSession(noVersion)).body).toBeNull();
    const strVersion = await encode({ token: { sub: user.id, authVersion: "0" }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
    expect((await readSession(strVersion)).body).toBeNull();
    const valid = await encode({ token: { sub: user.id, authVersion: 0 }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
    await prisma.user.delete({ where: { id: user.id } });
    expect((await readSession(valid)).body).toBeNull();
  });

  it("rejects expired tokens and tokens signed with another secret", async () => {
    const { jwt: expired } = await createUserAndToken(0, -300);
    expect((await readSession(expired)).body).toBeNull();
    const { user } = { user: await prisma.user.findUniqueOrThrow({ where: { email: "ali@example.com" } }) };
    const forged = await encode({ token: { sub: user.id, authVersion: 0 }, secret: "another-secret-another-secret-0123456789", salt: COOKIE, maxAge: 3600 });
    expect((await readSession(forged)).body).toBeNull();
  });
});
