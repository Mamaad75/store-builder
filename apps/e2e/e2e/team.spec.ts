import { AxeBuilder } from "@axe-core/playwright";
import { api, apiSignUp } from "./commerce";
import { expect, randomIp, test } from "./helpers";

/**
 * Staff, end to end with two real accounts: the owner invites on the Team page, the invitee accepts on the stores page, the menu follows
 * the role, the activity log records each step, and removing the member ends their access at once.
 */
const AXE = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test("team: invite, accept, change role, activity log, remove; the sidebar shows only what each role can use", async ({ page, browser }) => {
  await apiSignUp(page, "مالک تیم");
  const created = await api(page, "POST", "/stores", { name: "فروشگاه تیمی", templateKey: "general" });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const base = `/dashboard/stores/${id}`;

  const staffContext = await browser.newContext({ locale: "fa-IR", extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
  const staff = await staffContext.newPage();
  const staffUser = await apiSignUp(staff, "همکار آزمون");

  // ---- the owner invites a manager
  await page.goto(`${base}/team`);
  await expect(page.getByRole("heading", { name: "تیم فروشگاه" })).toBeVisible();
  await page.getByLabel("نام کاربری همکار").fill("nobody_here_123");
  await page.getByRole("button", { name: "ارسال دعوت" }).click();
  await expect(page.getByText("کاربری با این نام کاربری پیدا نشد")).toBeVisible(); // a precise refusal, not a generic error
  await page.getByLabel("نام کاربری همکار").fill(staffUser);
  await page.getByRole("combobox", { name: "نقش", exact: true }).click();
  await page.getByRole("option", { name: "مدیر" }).click();
  await page.getByRole("button", { name: "ارسال دعوت" }).click();
  await expect(page.getByTestId(`invitation-${staffUser}`)).toContainText("مدیر");
  const axe = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);

  // ---- the invitee sees it on the stores page and accepts
  await staff.goto("/dashboard");
  const invitation = staff.getByTestId("my-invitation-فروشگاه تیمی");
  await expect(invitation).toContainText("مدیر");
  const staffAxe = await new AxeBuilder({ page: staff }).withTags(AXE).include('[data-testid="shared-access"]').analyze();
  expect(staffAxe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);
  await invitation.getByRole("button", { name: /پذیرش دعوت/ }).click();
  await staff.waitForURL(new RegExp(`${base}/dashboard$`));

  // ---- a manager's menu: orders and the activity log, but no team page
  const menu = staff.getByRole("navigation", { name: "بخش‌های فروشگاه" });
  await expect(menu.getByRole("link", { name: "سفارش‌ها" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "گزارش فعالیت‌ها" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "تیم", exact: true })).toHaveCount(0);
  await staff.goto(`${base}/team`);
  await expect(staff.getByText("مدیریت تیم فقط برای مالک فروشگاه است")).toBeVisible();

  // ---- the owner makes them an operator (the member row reloads, the menu loses what an operator cannot do)
  await page.reload();
  const row = page.getByTestId(`member-${staffUser}`);
  await row.getByRole("combobox").click();
  await page.getByRole("option", { name: "کارمند" }).click();
  await expect(page.getByText("نقش «همکار آزمون» تغییر کرد.")).toBeVisible();
  await staff.goto(`${base}/products`);
  const opMenu = staff.getByRole("navigation", { name: "بخش‌های فروشگاه" });
  await expect(opMenu.getByRole("link", { name: "محصولات" }).first()).toBeVisible();
  for (const hidden of ["سفارش‌ها", "گزارش فعالیت‌ها", "تنظیمات", "انتشار", "داشبورد"]) await expect(opMenu.getByRole("link", { name: hidden, exact: true })).toHaveCount(0);

  // ---- the activity log shows who did what, with readable sentences
  await page.goto(`${base}/activity`);
  const actions = page.getByTestId("audit-row");
  await expect(actions.first()).toBeVisible();
  for (const a of ["staff.invited", "staff.joined", "staff.role_changed"]) await expect(page.locator(`[data-testid=audit-row][data-action="${a}"]`).first()).toBeVisible();
  await expect(page.getByText("همکار به تیم پیوست")).toBeVisible();
  await page.getByRole("combobox", { name: "نوع فعالیت" }).click();
  await page.getByRole("option", { name: "محصولات و دسته‌بندی‌ها" }).click();
  await expect(page.getByTestId("audit-empty")).toBeVisible(); // nothing of that kind happened yet
  await expect(page.locator("[role=listbox]")).toHaveCount(0); // the filter menu has finished closing (axe must not scan a fading menu item)
  const logAxe = await new AxeBuilder({ page }).withTags(AXE).analyze();
  expect(logAxe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);

  // ---- removing the member ends their access at once
  await page.goto(`${base}/team`);
  await page.getByRole("button", { name: "حذف همکار آزمون از تیم" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "حذف", exact: true }).click();
  await expect(page.getByTestId(`member-${staffUser}`)).toHaveCount(0);
  const gone = await staff.request.get(`/api/stores/${id}`, { failOnStatusCode: false });
  expect(gone.status()).toBe(404);
  await staff.goto("/dashboard");
  await expect(staff.getByTestId("shared-access")).toHaveCount(0);

  // ---- an invitation can be cancelled before it is answered
  await page.getByLabel("نام کاربری همکار").fill(staffUser);
  await page.getByRole("button", { name: "ارسال دعوت" }).click();
  await expect(page.getByTestId(`invitation-${staffUser}`)).toBeVisible();
  await page.getByRole("button", { name: "لغو دعوت همکار آزمون" }).click();
  await expect(page.getByTestId(`invitation-${staffUser}`)).toHaveCount(0);
  await staff.reload();
  await expect(staff.getByTestId("shared-access")).toHaveCount(0);
  await staffContext.close();
});
