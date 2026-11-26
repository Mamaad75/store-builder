import { AxeBuilder } from "@axe-core/playwright";
import { api, apiSignUp, createLiveStore } from "./commerce";
import { expect, test } from "./helpers";

/**
 * MVP item 3: the setup checklist on the store dashboard. A brand-new store shows every open item with a link to the page that fixes it;
 * finishing the steps through the real API ticks them off; a store that is fully set up shows no checklist.
 */
test("setup checklist: open items link to their pages, tick off as they are done, and disappear when complete", async ({ page }) => {
  await apiSignUp(page);
  const created = await api(page, "POST", "/stores", { name: "فروشگاه راه‌اندازی", templateKey: "general" });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const base = `/dashboard/stores/${id}`;

  await page.goto(base);
  const list = page.getByTestId("setup-checklist");
  await expect(list).toBeVisible();
  for (const key of ["product", "shipping", "payment", "subdomain", "publish"]) await expect(list.locator(`[data-step=${key}]`)).toHaveAttribute("data-done", "false");
  await expect(list.getByText("هنوز هیچ روش پرداختی فعال نیست")).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).include('[data-testid="setup-checklist"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  const href = (key: string) => list.locator(`[data-step=${key}]`).getByRole("link", { name: "انجام بده" });
  await expect(href("product")).toHaveAttribute("href", `${base}/products/new`);
  await expect(href("shipping")).toHaveAttribute("href", `${base}/shipping`);
  await expect(href("payment")).toHaveAttribute("href", `${base}/payments`);
  await expect(href("subdomain")).toHaveAttribute("href", `${base}/publish`);
  await expect(href("publish")).toHaveAttribute("href", `${base}/publish`);

  // A shipping method without cash on delivery completes "shipping" only: the shopper still could not pay.
  const put = await api(page, "PUT", `/stores/${id}/shipping-methods`, { methods: [{ name: "پیک", kind: "FLAT", price: 30_000 }] });
  expect(put.status(), await put.text()).toBe(200);
  await page.reload();
  await expect(list.locator("[data-step=shipping]")).toHaveAttribute("data-done", "true");
  await expect(list.locator("[data-step=payment]")).toHaveAttribute("data-done", "false");

  // Allowing cash on delivery on that method completes "payment".
  const cod = await api(page, "PUT", `/stores/${id}/shipping-methods`, { methods: [{ name: "پیک", kind: "FLAT", price: 30_000, cashOnDelivery: { enabled: true } }] });
  expect(cod.status(), await cod.text()).toBe(200);
  await page.reload();
  await expect(list.locator("[data-step=payment]")).toHaveAttribute("data-done", "true");
  await expect(list.getByText("هنوز هیچ روش پرداختی فعال نیست")).toHaveCount(0);
});

test("setup checklist: a fully set up, published store shows none", async ({ page }) => {
  await apiSignUp(page);
  const s = await createLiveStore(page);
  const answered = page.waitForResponse((r) => r.url().endsWith(`/stores/${s.storeId}/setup`));
  await page.goto(`/dashboard/stores/${s.storeId}`);
  expect((await answered).status()).toBe(200); // the checklist asked and was told "complete": that is why it is absent
  await expect(page.getByTestId("setup-checklist")).toHaveCount(0);
});
