import { AxeBuilder } from "@axe-core/playwright";
import { api, apiSignUp } from "./commerce";
import { expect, test } from "./helpers";

/** The panel's help and support page: reachable from the sidebar, answers expand, and the merchant gets the details support will ask for. */
test("support: sidebar entry, expanding answers, the store and account details to send, no invented contact", async ({ page }) => {
  const username = await apiSignUp(page, "مالک راهنما");
  const created = await api(page, "POST", "/stores", { name: "فروشگاه راهنما", templateKey: "general" });
  const { id } = (await created.json()) as { id: string };
  await page.goto(`/dashboard/stores/${id}/dashboard`);
  await page.getByRole("navigation", { name: "بخش‌های فروشگاه" }).getByRole("link", { name: "راهنما و پشتیبانی" }).click();
  await page.waitForURL(new RegExp(`/dashboard/stores/${id}/support$`));
  await expect(page.getByRole("heading", { name: "راهنما و پشتیبانی" })).toBeVisible();

  const q = page.getByRole("button", { name: "کد رهگیری مرسوله را کجا بنویسم؟" });
  await expect(q).toHaveAttribute("aria-expanded", "false");
  await q.click();
  await expect(q).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("هنگام «ثبت ارسال» می‌توانید کد پست یا باربری را بنویسید")).toBeVisible();

  const info = page.getByTestId("support-info");
  await expect(info).toContainText("فروشگاه راهنما");
  await expect(info).toContainText(id);
  await expect(info).toContainText(username);
  // nothing is invented: with no channel configured the page says so plainly (the owner fills them in before the pilot)
  await expect(page.getByTestId("support-contact")).toContainText("راه‌های تماس پشتیبانی به‌زودی");

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);
});
