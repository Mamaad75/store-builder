import { writeFileSync } from "node:fs";
import type { Browser, CDPSession, Page } from "@playwright/test";
import sharp from "sharp";
import { api, apiSignUp, shopper, storeUrl } from "./commerce";
import { expect, test } from "./helpers";

/**
 * A LAB MEASUREMENT of the storefront, not a pass/fail test (skipped unless PERF=1): every theme family's home, product list and product page, on a
 * phone profile (4x slower CPU, "slow 4G"), against the production build of the E2E stack. It reports transferred bytes by kind, requests, LCP, CLS and
 * the long-task time (a proxy for blocking). Numbers are for comparing themes and changes with each other, not absolute Lighthouse scores.
 *   PERF=1 pnpm --filter @store-builder/e2e exec playwright test e2e/perf.spec.ts   ->  /tmp/perf-report.json
 */
const ALL = ["general", "coffee", "fashion", "appliances", "bazaar", "circuit", "sormeh", "dookht", "arcade", "sofreh", "golkhaneh", "khaneh"];
/** PERF_THEMES=a,b limits the run (a full run over every theme takes over an hour on the slow profile). */
const THEMES = process.env.PERF_THEMES ? process.env.PERF_THEMES.split(",") : ALL;
const PRODUCTS = 12;
const RUNS = Number(process.env.PERF_RUNS ?? 3);
const PAGES = (process.env.PERF_PAGES ?? "home,products,product").split(",");

/** A noisy 2000x1500 photograph-like picture (noise makes realistic file sizes, unlike a flat colour). */
async function photo(seed: number) {
  const w = 2000;
  const h = 1500;
  const raw = Buffer.alloc(w * h * 3);
  let x = seed * 2654435761;
  for (let i = 0; i < raw.length; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    raw[i] = ((i / 3 / w) * 0.15 + (x >>> 24) * 0.85 + seed * 7) & 255;
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 88 }).toBuffer();
}

async function makeStore(page: Page, theme: string, label: string) {
  const store = (await (await api(page, "POST", "/stores", { name: `فروشگاه ${theme}`, templateKey: theme })).json()) as { id: string };
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:3100").origin;
  let first = "";
  for (let i = 0; i < PRODUCTS; i++) {
    const p = (await (await api(page, "POST", `/stores/${store.id}/products`, { name: `محصول شمارهٔ ${i + 1}`, price: 100_000 + i * 1000, stockQuantity: 5, description: "توضیح کوتاهی دربارهٔ این محصول برای آزمون." })).json()) as { id: string; slug: string };
    await api(page, "POST", `/stores/${store.id}/products/${p.id}/status`, { status: "ACTIVE" });
    const up = await page.request.fetch(`${origin}/api/stores/${store.id}/products/${p.id}/image`, { method: "POST", headers: { origin, "content-type": "application/octet-stream" }, data: await photo(i + 1), failOnStatusCode: false });
    expect(up.status()).toBe(200);
    if (i === 0) first = p.slug;
  }
  await api(page, "PUT", `/stores/${store.id}/shipping-methods`, { methods: [{ name: "پیک", kind: "FLAT", price: 30_000, cashOnDelivery: { enabled: true } }] });
  await api(page, "POST", `/stores/${store.id}/subdomain`, { label });
  const state = (await (await api(page, "GET", `/stores/${store.id}/publish`)).json()) as { draftRevision?: number; draft?: { revision?: number } };
  expect((await api(page, "POST", `/stores/${store.id}/publish`, { expectedDraftRevision: state.draftRevision ?? state.draft?.revision })).ok()).toBe(true);
  return { storeId: store.id, firstSlug: first };
}

interface Sample { lcp: number; cls: number; longTaskMs: number; bytes: Record<string, number>; requests: number; load: number }

async function measure(browser: Browser, url: string): Promise<Sample> {
  const { context, page } = await shopper(browser);
  const cdp: CDPSession = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.setViewportSize({ width: 412, height: 823 });
  const types = new Map<string, string>();
  const bytes: Record<string, number> = { document: 0, script: 0, stylesheet: 0, image: 0, font: 0, other: 0 };
  let requests = 0;
  cdp.on("Network.requestWillBeSent", (e: { requestId: string; type?: string }) => { types.set(e.requestId, (e.type ?? "Other").toLowerCase()); requests++; });
  cdp.on("Network.loadingFinished", (e: { requestId: string; encodedDataLength: number }) => {
    const t = types.get(e.requestId) ?? "other";
    const k = t in bytes ? t : "other";
    bytes[k] = (bytes[k] ?? 0) + e.encodedDataLength;
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __m: { lcp: number; cls: number; lt: number } };
    w.__m = { lcp: 0, cls: 0, lt: 0 };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__m.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__m.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__m.lt += Math.max(0, e.duration - 50); }).observe({ type: "longtask", buffered: true });
  });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(1500); // let late paints and layout shifts happen
  const m = await page.evaluate(() => (window as unknown as { __m: { lcp: number; cls: number; lt: number } }).__m);
  const load = await page.evaluate(() => performance.getEntriesByType("navigation").map((n) => (n as PerformanceNavigationTiming).loadEventEnd)[0] ?? 0);
  await context.close();
  return { lcp: Math.round(m.lcp), cls: Math.round(m.cls * 1000) / 1000, longTaskMs: Math.round(m.lt), bytes, requests, load: Math.round(load) };
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

test("storefront performance report (PERF=1)", async ({ browser, page }) => {
  test.skip(!process.env.PERF, "a measurement, run on demand with PERF=1");
  test.setTimeout(55 * 60_000);
  const report: Record<string, unknown>[] = [];
  let owner = 0;
  for (const [i, theme] of THEMES.entries()) {
    if (i % 5 === 0) { owner++; await apiSignUp(page, `فروشنده ${owner}`); } // a user may own ten stores at most
    const label = `perf${theme}${Math.random().toString(36).slice(2, 6)}`;
    const s = await makeStore(page, theme, label);
    for (const [name, path] of ([["home", "/"], ["products", "/products"], ["product", `/products/${s.firstSlug}`]] as const).filter(([n]) => PAGES.includes(n))) {
      const runs: Sample[] = [];
      for (let r = 0; r < RUNS; r++) runs.push(await measure(browser, storeUrl(label, path)));
      const kb = (k: string) => Math.round(median(runs.map((x) => x.bytes[k] ?? 0)) / 1024);
      const row = { theme, page: name, lcpMs: median(runs.map((x) => x.lcp)), cls: median(runs.map((x) => x.cls)), longTaskMs: median(runs.map((x) => x.longTaskMs)), totalKB: Math.round(median(runs.map((x) => Object.values(x.bytes).reduce((a, b) => a + b, 0))) / 1024), imageKB: kb("image"), scriptKB: kb("script"), cssKB: kb("stylesheet"), fontKB: kb("font"), docKB: kb("document"), requests: median(runs.map((x) => x.requests)) };
      report.push(row);
      writeFileSync("/tmp/perf-report.json", JSON.stringify(report, null, 1));
    }
  }
});
