import type { Browser } from "@playwright/test";
import { createStoreViaUi, db, expect, randomIp, signUpAndIn, test, waitForHydration } from "./helpers";

test.afterAll(() => db.$disconnect());
// Multi-step flows against the real server: give a throttled/slow CI machine more than the default 30 s per test.
test.describe.configure({ timeout: 90_000 });

type Sec = { id: string; type: string; props: Record<string, unknown> };
const pagesOf = async (storeId: string) => (await db.page.findMany({ where: { storeId }, orderBy: { type: "asc" } })).map((p) => ({ type: p.type, sections: p.sections, revision: p.revision, legacy: p.legacySections }));
const themeOf = async (storeId: string) => (await db.store.findUniqueOrThrow({ where: { id: storeId }, include: { templateVersion: { include: { template: true } } } })).templateVersion.template.key;
const homeSections = async (storeId: string) => (await db.page.findFirstOrThrow({ where: { storeId, type: "HOME" } })).sections as Sec[];
const contact: Sec = { id: "extra-contact", type: "contactInfo", props: { title: "تماس ویژه", body: "متن یکتای بخش اضافی ۴۲۴۲" } };
const hours = (id: string): Sec => ({ id, type: "coffee.openingHours", props: { title: "ساعت کاری", body: "شنبه: ۸ تا ۲۲", note: "" } });

const openCompat = async (page: import("@playwright/test").Page, storeId: string, target: string) => {
  await page.goto(`/dashboard/stores/${storeId}/appearance`);
  await expect(page.getByTestId("theme-picker")).toBeVisible();
  await page.locator(`[data-testid=theme-card][data-theme-key=${target}]`).getByTestId("theme-check-link").click();
  await expect(page.getByTestId("theme-switch-panel")).toHaveAttribute("data-target", target);
};

async function otherUser(browser: Browser) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
  const page = await context.newPage();
  await signUpAndIn(page);
  return { context, page };
}

test.describe("theme switching: compatibility report, draft-only switch, round trip", () => {
  test("report -> switch -> sections become dormant -> switch back restores them; nothing stored changes", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "فروشگاه تغییر قالب", "general");
    await db.page.updateMany({ where: { storeId, type: "HOME" }, data: { sections: [...(await homeSections(storeId)), contact] as never } });
    const original = await pagesOf(storeId);

    await openCompat(page, storeId, "coffee");
    const panel = page.getByTestId("theme-switch-panel");
    await expect(panel).toHaveAttribute("data-can-switch", "yes");
    await expect(page.getByTestId("compat-become-dormant")).toContainText("۱"); // the extra contactInfo section on HOME
    const dormantEntry = page.getByTestId("compat-entry").filter({ has: page.locator("[data-change=becomes_dormant]") }).or(page.locator("[data-testid=compat-entry][data-change=becomes_dormant]"));
    await expect(dormantEntry.first()).toContainText("غیرفعال می‌شود");
    await expect(page.getByTestId("compat-new-invalid")).toContainText("۰");
    // opening the report changed nothing
    expect(await themeOf(storeId)).toBe("general");
    expect(await pagesOf(storeId)).toEqual(original);

    await waitForHydration(page, "[data-testid=theme-switch-panel] form");
    await page.getByTestId("switch-theme-submit").click();
    await expect(page.getByTestId("switch-success")).toBeVisible({ timeout: 20_000 });
    expect(await themeOf(storeId)).toBe("coffee");
    expect(await pagesOf(storeId)).toEqual(original); // zero page writes
    await expect(page.locator("[data-testid=theme-card][data-theme-key=coffee]")).toHaveAttribute("data-current", "yes");

    // the extra section is dormant in the editor, and the draft preview renders the coffee theme without it
    await page.goto(`/dashboard/stores/${storeId}/pages/home`);
    await expect(page.getByTestId("dormant-panel")).toContainText("تماس");
    await page.goto(`/preview/${storeId}`);
    await expect(page.locator("[data-template=coffee]")).toBeVisible();
    await expect(page.getByText("متن یکتای بخش اضافی ۴۲۴۲")).toHaveCount(0);

    // back to a theme that approves it: it reappears, byte-for-byte as stored
    await openCompat(page, storeId, "general");
    await expect(page.locator("[data-testid=compat-entry][data-change=becomes_active]").first()).toContainText("دوباره فعال می‌شود");
    await waitForHydration(page, "[data-testid=theme-switch-panel] form");
    await page.getByTestId("switch-theme-submit").click();
    await expect(page.getByTestId("switch-success")).toBeVisible({ timeout: 20_000 });
    expect(await themeOf(storeId)).toBe("general");
    expect(await pagesOf(storeId)).toEqual(original);
    await page.goto(`/dashboard/stores/${storeId}/pages/home`);
    await expect(page.getByTestId("dormant-panel")).toHaveCount(0);
    await page.goto(`/preview/${storeId}`);
    await expect(page.locator("[data-template=general]")).toBeVisible();
    await expect(page.getByText("متن یکتای بخش اضافی ۴۲۴۲")).toBeVisible();
  });

  test("a switch that would create a NEW invalid section is blocked with the report; pre-existing invalid data is not a blocker", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "مسدود", "general");
    // two opening-hours sections are dormant under general; coffee treats it as a singleton -> the 2nd would become invalid
    await db.page.updateMany({ where: { storeId, type: "HOME" }, data: { sections: [...(await homeSections(storeId)), hours("h1"), hours("h2")] as never } });
    // plus a corrupt entry on another page that must NOT block
    await db.page.updateMany({ where: { storeId, type: "ABOUT" }, data: { sections: [{ junk: true }] as never } });
    const original = await pagesOf(storeId);

    await openCompat(page, storeId, "coffee");
    await expect(page.getByTestId("theme-switch-panel")).toHaveAttribute("data-can-switch", "no");
    await expect(page.getByTestId("compat-blocked")).toBeVisible();
    await expect(page.locator("[data-testid=compat-blocker][data-kind=new_invalid]")).toHaveCount(1);
    await expect(page.getByTestId("compat-pre-invalid")).toContainText("۱");
    await expect(page.getByTestId("switch-theme-submit")).toBeDisabled();
    expect(await themeOf(storeId)).toBe("general");
    expect(await pagesOf(storeId)).toEqual(original);

    // fashion has no such conflict: the same store can switch, the corrupt ABOUT entry is untouched
    await openCompat(page, storeId, "fashion");
    await expect(page.getByTestId("theme-switch-panel")).toHaveAttribute("data-can-switch", "yes");
    await waitForHydration(page, "[data-testid=theme-switch-panel] form");
    await page.getByTestId("switch-theme-submit").click();
    await expect(page.getByTestId("switch-success")).toBeVisible({ timeout: 20_000 });
    expect(await themeOf(storeId)).toBe("fashion");
    expect(await pagesOf(storeId)).toEqual(original);
  });

  test("a report that went stale (the draft changed meanwhile) is refused with an explanation and nothing is applied", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "کهنه", "general");
    await openCompat(page, storeId, "fashion");
    await waitForHydration(page, "[data-testid=theme-switch-panel] form");
    await db.store.update({ where: { id: storeId }, data: { draftRevision: { increment: 1 } } }); // another tab edited the draft
    await page.getByTestId("switch-theme-submit").click();
    await expect(page.getByTestId("switch-error")).toContainText("تغییر کرده", { timeout: 20_000 });
    expect(await themeOf(storeId)).toBe("general");
  });
});

test.describe("candidate-theme preview (?theme=)", () => {
  test("renders the draft with another theme, says it is not applied, keeps the theme on links, and stores nothing", async ({ page }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "پیش‌نمایش قالب", "general");
    const before = { pages: await pagesOf(storeId), store: await db.store.findUniqueOrThrow({ where: { id: storeId } }) };

    const res = await page.goto(`/preview/${storeId}?theme=fashion`);
    expect(res?.status()).toBe(200);
    await expect(page.locator("[data-template=fashion]")).toBeVisible();
    await expect(page.getByTestId("preview-candidate-banner")).toContainText("چیزی ذخیره یا منتشر نشده");
    await expect(page.getByTestId("preview-banner")).toBeVisible(); // the usual draft banner is still there
    // internal links keep the candidate theme so the owner can browse it
    const hrefs = await page.locator("nav a, header a").evaluateAll((as) => (as as HTMLAnchorElement[]).map((a) => a.getAttribute("href") ?? ""));
    const internal = hrefs.filter((h) => h.startsWith(`/preview/${storeId}`));
    expect(internal.length).toBeGreaterThan(0);
    for (const h of internal) expect(h, h).toContain("theme=fashion");
    await page.goto(`/preview/${storeId}/products?theme=fashion`);
    await expect(page.locator("[data-template=fashion]")).toBeVisible();

    // without the parameter it is the store's own theme again
    await page.goto(`/preview/${storeId}`);
    await expect(page.locator("[data-template=general]")).toBeVisible();
    await expect(page.getByTestId("preview-candidate-banner")).toHaveCount(0);

    expect(await themeOf(storeId)).toBe("general");
    expect(await pagesOf(storeId)).toEqual(before.pages);
    const after = await db.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(after.draftRevision).toBe(before.store.draftRevision);
    expect(after.templateVersionId).toBe(before.store.templateVersionId);
  });

  test("unknown or malformed candidates show a neutral notice, and another tenant gets the same 404 as for a missing store", async ({ page, browser }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "خصوصی", "general");
    for (const theme of ["nope", "../etc", "Coffee", "x".repeat(80)]) {
      const res = await page.goto(`/preview/${storeId}?theme=${encodeURIComponent(theme)}`);
      expect(res?.status(), theme).toBe(200);
      await expect(page.getByTestId("preview-candidate-unavailable"), theme).toBeVisible();
      await expect(page.locator("[data-template]")).toHaveCount(0);
    }
    const intruder = await otherUser(browser);
    const foreign = await intruder.page.goto(`/preview/${storeId}?theme=coffee`);
    const missing = await intruder.page.goto(`/preview/cmissing00000000000000000?theme=coffee`);
    expect(foreign?.status()).toBe(404);
    expect(missing?.status()).toBe(404);
    expect(await intruder.page.locator("body").innerText()).not.toContain("خصوصی");
    await intruder.context.close();
  });

  test("another tenant cannot read a compatibility report or switch the theme", async ({ page, browser }) => {
    await signUpAndIn(page);
    const storeId = await createStoreViaUi(page, "مال من", "general");
    const intruder = await otherUser(browser);
    const res = await intruder.page.goto(`/dashboard/stores/${storeId}/appearance?target=coffee`);
    expect(res?.status()).toBe(404);
    expect(await themeOf(storeId)).toBe("general");
    await intruder.context.close();
  });
});
