import { AxeBuilder } from "@axe-core/playwright";
import { api, apiSignUp, createLiveStore, pngBytes, storeUrl } from "./commerce";
import { expect, test, waitForHydration } from "./helpers";

/**
 * The eNamad seal end to end: the merchant pastes the snippet from the eNamad panel, publishes, and the storefront footer shows the official
 * image (allowed by the page's security policy for that one host) linking to the verification page; removing it takes it away again.
 */
const SNIPPET = `<a referrerpolicy='origin' target='_blank' href='https://trustseal.enamad.ir/?id=123456&Code=AbCdEfGh12345678'><img referrerpolicy='origin' src='https://trustseal.enamad.ir/logo.aspx?id=123456&Code=AbCdEfGh12345678' alt='' style='cursor:pointer' code='AbCdEfGh12345678'></a>`;

async function republish(page: import("@playwright/test").Page, storeId: string) {
  const st = (await (await api(page, "GET", `/stores/${storeId}/publish`)).json()) as { draftRevision: number };
  const r = await api(page, "POST", `/stores/${storeId}/publish`, { expectedDraftRevision: st.draftRevision });
  expect(r.status(), await r.text()).toBeLessThan(300);
}

test("eNamad: paste the snippet, publish, the footer shows the official seal under the CSP; invalid paste refused; remove", async ({ page, context }) => {
  await apiSignUp(page);
  const s = await createLiveStore(page);

  // the real eNamad host is not reachable from tests: answer its image request, so the browser's own CSP decision is what is tested
  const requested: string[] = [];
  await context.route("https://trustseal.enamad.ir/**", async (route) => {
    requested.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "image/png", body: pngBytes(40, 44) });
  });

  await page.goto(`/dashboard/stores/${s.storeId}`);
  await waitForHydration(page, "form");
  const box = page.getByTestId("enamad-input");
  await box.fill("hello");
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await expect(page.getByText("کد اینماد شناسایی نشد").first()).toBeVisible(); // nothing saved
  await box.fill("<script>alert(1)</script> " + SNIPPET);
  await expect(page.getByText("شناسایی شد: شناسهٔ 123456، کد AbCdEfGh12345678")).toBeVisible(); // only the two values are read
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await expect(page.getByText("تغییرات ذخیره شد.")).toBeVisible();
  const saved = (await (await api(page, "GET", `/stores/${s.storeId}`)).json()) as { settings: { enamad: unknown } };
  expect(saved.settings.enamad).toEqual({ id: "123456", code: "AbCdEfGh12345678" });
  expect(JSON.stringify(saved.settings)).not.toMatch(/<|>|alert\(/); // the pasted <script> never reached the settings

  await republish(page, s.storeId);
  const shopper = await context.newPage();
  const resp = await shopper.goto(storeUrl(s.label));
  const csp = resp!.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/img-src [^;]*https:\/\/trustseal\.enamad\.ir/);
  const seal = shopper.getByTestId("enamad-seal");
  await expect(seal).toBeVisible();
  await expect(seal.getByRole("link")).toHaveAttribute("href", "https://trustseal.enamad.ir/?id=123456&Code=AbCdEfGh12345678");
  await expect(seal.getByRole("link")).toHaveAttribute("target", "_blank");
  const img = seal.getByRole("img", { name: "نماد اعتماد الکترونیکی" });
  await expect(img).toHaveAttribute("src", "https://trustseal.enamad.ir/logo.aspx?id=123456&Code=AbCdEfGh12345678");
  // the browser really loaded it: the policy let this one host through
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(requested.some((u) => u.includes("logo.aspx?id=123456"))).toBe(true);
  const axe = await new AxeBuilder({ page: shopper }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).include('[data-testid="enamad-seal"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);

  // removing it: empty box, save, publish -> gone
  await page.goto(`/dashboard/stores/${s.storeId}`);
  await waitForHydration(page, "form");
  await page.getByTestId("enamad-input").fill("");
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await expect(page.getByText("تغییرات ذخیره شد.")).toBeVisible();
  await republish(page, s.storeId);
  await shopper.reload();
  await expect(shopper.getByTestId("enamad-seal")).toHaveCount(0);
});
