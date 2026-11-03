import { randomBytes } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { E2E_DATABASE_URL } from "../playwright.config";

export const db = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } });

export const PASSWORD = "password123";
export const GENERIC_LOGIN_ERROR = "ایمیل یا رمز عبور نادرست است.";
export const RATE_LIMIT_TEXT = "بیش از حد";

export const uniqueEmail = () => `user-${randomBytes(6).toString("hex")}@example.com`;
const randomIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${1 + (randomBytes(1)[0]! % 250)}`;

/** Every test acts from its own client IP (as a trusted proxy would report it) => isolated rate-limit buckets. */
export const test = base.extend<{ ip: string }>({
  ip: async ({}, provide) => provide(randomIp()),
  context: async ({ context, ip }, provide) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": ip });
    await provide(context);
  },
});
export { expect };

export async function register(page: Page, email: string, name = "علی", password = PASSWORD) {
  await page.goto("/register");
  await page.fill("input[name=name]", name);
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", password);
  await page.click("button[type=submit]");
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", password);
  await page.click("button[type=submit]");
}

export async function createUser(page: Page, email = uniqueEmail()) {
  await register(page, email);
  await page.waitForURL(/\/login\?registered=1/);
  return email;
}

export async function loginAndWaitForDashboard(page: Page, email: string) {
  await login(page, email);
  await page.waitForURL(/\/dashboard/);
}

export const formAlert = (page: Page) => page.locator(".MuiAlert-message");
