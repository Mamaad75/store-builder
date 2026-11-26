import { AxeBuilder } from "@axe-core/playwright";
import { api, apiSignUp, createLiveStore, makeSuperAdmin, shopper } from "./commerce";
import { expect, test, waitForHydration } from "./helpers";

/** Support requests end to end: the merchant writes in the dashboard, platform staff answer in /platform/tickets, the merchant sees the answer. */
test("support: a merchant opens a request, staff answer it, the merchant sees the reply and closes it", async ({ page, browser }) => {
  await apiSignUp(page);
  const live = await createLiveStore(page);
  await page.goto(`/dashboard/stores/${live.storeId}/tickets`);
  await waitForHydration(page, "form button[type=submit]");

  // a refusal is explained in Persian, nothing is created
  await page.getByLabel("موضوع").fill("ab");
  await page.getByLabel(/شرح مشکل/).fill("متن کافی برای ثبت");
  await page.getByRole("button", { name: "ثبت درخواست" }).click();
  await expect(page.getByText(/موضوع را کوتاه و روشن بنویسید/)).toBeVisible();

  await page.getByLabel("موضوع").fill("مشکل در انتشار فروشگاه");
  await page.getByRole("button", { name: "ثبت درخواست" }).click();
  const row = page.getByTestId("ticket-row").filter({ hasText: "مشکل در انتشار فروشگاه" });
  await expect(row).toContainText("در انتظار پشتیبانی");
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);

  // staff: a separate browser session answers
  const { context: staffCtx, page: staff } = await shopper(browser);
  await makeSuperAdmin(staff);
  await staff.goto("/platform/tickets");
  const srow = staff.getByTestId("staff-ticket-row").filter({ hasText: "مشکل در انتشار فروشگاه" });
  await expect(srow).toContainText(`فروشگاه ${live.label}`);
  await srow.getByRole("link", { name: "مشکل در انتشار فروشگاه" }).click();
  await staff.getByLabel("پیام شما").fill("سلام، مشکل را بررسی کردیم و برطرف شد.");
  await staff.getByRole("button", { name: "ارسال پیام" }).click();
  await expect(staff.getByTestId("ticket-message")).toHaveCount(2);
  const staffAxe = await new AxeBuilder({ page: staff }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(staffAxe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);

  // the merchant sees the answer (marked as the platform's, no staff name) and closes the request
  await row.getByRole("link").click();
  await expect(page.getByTestId("ticket-message").nth(1)).toContainText("سلام، مشکل را بررسی کردیم");
  await expect(page.getByTestId("ticket-message").nth(1)).toContainText("پشتیبانی");
  await page.getByRole("button", { name: "بستن درخواست" }).click();
  await expect(page.getByText("این درخواست بسته است؛ با ارسال پیام تازه دوباره باز می‌شود.")).toBeVisible();
  expect(((await (await api(page, "GET", `/stores/${live.storeId}/tickets`)).json()) as { status: string }[])[0]!.status).toBe("CLOSED");

  // another merchant cannot open this request's page
  const { context: otherCtx, page: other } = await shopper(browser);
  await apiSignUp(other);
  const l2 = await createLiveStore(other);
  const id = ((await (await api(page, "GET", `/stores/${live.storeId}/tickets`)).json()) as { id: string }[])[0]!.id;
  await other.goto(`/dashboard/stores/${l2.storeId}/tickets/${id}`);
  await expect(other.getByText("این درخواست پیدا نشد.")).toBeVisible();
  // and a normal merchant is not a platform admin
  expect((await api(other, "GET", "/v1/platform/tickets")).status()).toBe(403);
  await otherCtx.close();
  await staffCtx.close();
});
