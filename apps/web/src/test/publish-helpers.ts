import { createStore } from "@/modules/stores/service";
import { createProduct, changeProductStatus } from "@/modules/products/service";
import { makeUser, prisma } from "./db-helpers";
import { validProduct } from "./catalog-helpers";

let n = 0;
/** A store with a claimed subdomain (inserted directly) and `products` ACTIVE products. */
export async function publishableStore(opts: { products?: number; template?: string; label?: string } = {}) {
  const u = await makeUser();
  const { id } = await createStore(u.id, { name: "فروشگاه", templateKey: opts.template ?? "general" });
  n += 1;
  const label = opts.label ?? `shop-${n}-${Math.random().toString(36).slice(2, 7)}`;
  await prisma.domain.create({ data: { storeId: id, kind: "SUBDOMAIN", host: label, verifiedAt: new Date() } });
  const productIds: string[] = [];
  for (let i = 0; i < (opts.products ?? 2); i++) {
    const p = await createProduct(u.id, id, validProduct({ name: `محصول ${i + 1}` }));
    await changeProductStatus(u.id, id, p.id, "ACTIVE");
    productIds.push(p.id);
  }
  return { owner: u, storeId: id, label, productIds };
}

export const draftRevisionOf = async (storeId: string) => (await prisma.store.findUniqueOrThrow({ where: { id: storeId } })).draftRevision;
export const pagesJson = async (storeId: string) => JSON.stringify(await prisma.page.findMany({ where: { storeId }, orderBy: { type: "asc" } }));
