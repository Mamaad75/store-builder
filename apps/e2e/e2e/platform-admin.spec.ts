import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { api, apiSignUp, createLiveStore, makeSuperAdmin, shopper } from "./commerce";
import { expect, test } from "./helpers";

const clean = async (page: Page, what: string) => {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${what} ${v.id}: ${v.nodes[0]?.html.slice(0, 90)}`)).toEqual([]);
};

/** The super admin's dashboard, accounts, store detail and activity log, on real data made by real merchants. */
test("platform admin: dashboard figures, accounts, a store's detail, and the activity log", async ({ browser }) => {
  const { context: mCtx, page: m } = await shopper(browser);
  const username = await apiSignUp(m, "فروشندهٔ آزمون");
  const live = await createLiveStore(m);
  await api(m, "POST", `/stores/${live.storeId}/tickets`, { subject: "پرسش آزمایشی", body: "متن پرسش برای آزمون داشبورد" });

  const { context: sCtx, page: s } = await shopper(browser);
  await makeSuperAdmin(s);
  const plan = (await (await api(s, "POST", "/v1/platform/plans", { name: "ماهانه", priceToman: 200_000, durationDays: 30 })).json()) as { id: string };
  expect((await api(s, "POST", `/v1/platform/stores/${live.storeId}/purchases`, { planId: plan.id, note: "یادداشت محرمانهٔ آزمون ۴۲۴۲" })).status()).toBe(201);
  expect((await api(s, "POST", `/v1/platform/stores/${live.storeId}/wallet-adjust`, { amountToman: 1000, reason: "دلیل محرمانهٔ آزمون ۸۸۸۸" })).status()).toBe(200);

  // the dashboard shows what the API says (the shared test database also holds other tests' data, so the figures are compared, not assumed)
  const fa = (n: number) => n.toLocaleString("fa-IR");
  const dash = async (days: number) => (await (await api(s, "GET", `/v1/platform/dashboard?days=${days}`)).json()) as { figures: { openTickets: number; activeSubscriptions: number; walletOutstandingToman: number }; totals: { current: { revenue: number; newStores: number } } };
  const d30 = await dash(30);
  expect(d30.figures.openTickets).toBeGreaterThanOrEqual(1);
  expect(d30.figures.activeSubscriptions).toBeGreaterThanOrEqual(1);
  expect(d30.figures.walletOutstandingToman).toBeGreaterThanOrEqual(1000);
  expect(d30.totals.current.revenue).toBeGreaterThanOrEqual(200_000);
  expect(d30.totals.current.newStores).toBeGreaterThanOrEqual(1);
  await s.goto("/platform");
  await expect(s.getByTestId("tile-open-tickets")).toContainText(fa(d30.figures.openTickets));
  await expect(s.getByTestId("tile-subscriptions")).toContainText(fa(d30.figures.activeSubscriptions));
  await expect(s.getByTestId("tile-wallets")).toContainText(`${fa(d30.figures.walletOutstandingToman)} تومان`);
  await expect(s.getByTestId("kpi-revenue")).toContainText(`${fa(d30.totals.current.revenue)} تومان`);
  await expect(s.getByTestId("kpi-stores")).toContainText(fa(d30.totals.current.newStores));
  await expect(s.getByTestId("chart-revenue")).toBeVisible();
  await s.getByTestId("range-7").click();
  await expect(s.getByTestId("kpi-revenue")).toContainText(`${fa((await dash(7)).totals.current.revenue)} تومان`);
  await clean(s, "dashboard");
  await s.setViewportSize({ width: 320, height: 700 });
  expect(await s.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await s.setViewportSize({ width: 1280, height: 800 });

  // accounts: search, then the detail with the store
  await s.goto("/platform/users");
  await s.getByRole("textbox", { name: "نام کاربری یا نام" }).fill(username.toUpperCase());
  await s.getByRole("button", { name: "جستجو" }).click();
  await expect(s.getByTestId("account-row")).toHaveCount(1);
  await clean(s, "users");
  await s.getByTestId("account-row").getByRole("link").click();
  await expect(s.getByTestId("account-summary")).toContainText("فروشندهٔ آزمون");
  await expect(s.getByRole("link", { name: `فروشگاه ${live.label}` })).toBeVisible();
  await clean(s, "account");

  // the store's detail: counts without order values, finance summary
  await s.getByRole("link", { name: `فروشگاه ${live.label}` }).click();
  await expect(s.getByTestId("fact-products")).toHaveText("۱");
  await expect(s.getByTestId("store-finance")).toContainText("ماهانه");
  await expect(s.getByTestId("store-finance")).toContainText("۱٬۰۰۰ تومان");
  await expect(s.getByTestId("store-summary")).toContainText(username);
  await clean(s, "store detail");
  await expect(s.getByRole("link", { name: "مالی و اشتراک" })).toBeVisible();

  // the activity log: labelled, with the staff member, safe facts only, filtered by group
  await s.goto("/platform/activity");
  await expect(s.getByTestId("activity-row").first()).toContainText("اعتبار کیف پول یک فروشگاه تنظیم شد");
  await expect(s.getByTestId("activity-row").filter({ hasText: "خرید اشتراک برای یک فروشگاه ثبت شد" }).first()).toContainText("دریافتی: ۲۰۰٬۰۰۰ تومان");
  const html = await s.content();
  expect(html).not.toContain("۴۲۴۲");
  expect(html).not.toContain("۸۸۸۸");
  await clean(s, "activity");
  // the group filter narrows the list (other tests' entries share the database, so presence and absence are checked, not counts)
  await s.getByRole("combobox", { name: "گروه" }).click();
  await s.getByRole("option", { name: "پشتیبانی" }).click();
  await expect(s.getByTestId("activity-row").filter({ hasText: "خرید اشتراک برای یک فروشگاه ثبت شد" })).toHaveCount(0);
  await s.getByRole("combobox", { name: "گروه" }).click();
  await s.getByRole("option", { name: "پلن‌ها و مالی" }).click();
  for (const label of ["پلن اشتراک ساخته شد", "خرید اشتراک برای یک فروشگاه ثبت شد", "اعتبار کیف پول یک فروشگاه تنظیم شد"]) await expect(s.getByTestId("activity-row").filter({ hasText: label }).first()).toBeVisible();

  // a merchant cannot see any of it
  for (const path of ["/v1/platform/dashboard", "/v1/platform/accounts", "/v1/platform/activity", `/v1/platform/stores/${live.storeId}/detail`]) expect((await api(m, "GET", path)).status(), path).toBe(403);
  await mCtx.close();
  await sCtx.close();
});
