import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type Client = Prisma.TransactionClient | typeof db;

/** Fields safe to hand to the UI. Never exposes other tenants' data or auth data. */
export const storeSelect = {
  id: true,
  name: true,
  status: true,
  settings: true,
  draftRevision: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  templateVersion: { select: { version: true, template: { select: { key: true, name: true } } } },
} satisfies Prisma.StoreSelect;

export type StoreView = Prisma.StoreGetPayload<{ select: typeof storeSelect }>;

/**
 * Every query is bound to one owner. There is deliberately no method that accepts a bare store id
 * without the owner condition, so a forgotten check is not possible through this class.
 */
export class StoreRepository {
  constructor(
    private readonly ownerId: string,
    private readonly client: Client = db,
  ) {
    if (!ownerId) throw new Error("StoreRepository requires an ownerId");
  }

  list(): Promise<StoreView[]> {
    return this.client.store.findMany({
      where: { ownerId: this.ownerId },
      select: storeSelect,
      orderBy: { createdAt: "desc" },
    });
  }

  count(): Promise<number> {
    return this.client.store.count({ where: { ownerId: this.ownerId } });
  }

  find(storeId: string): Promise<StoreView | null> {
    return this.client.store.findFirst({ where: { id: storeId, ownerId: this.ownerId }, select: storeSelect });
  }

  /** Optimistic update: succeeds only if the row is still owned by the user and at the expected revision. */
  async updateDraft(storeId: string, expectedRevision: number, data: { name?: string; settings: Prisma.InputJsonValue }) {
    const res = await this.client.store.updateMany({
      where: { id: storeId, ownerId: this.ownerId, draftRevision: expectedRevision },
      data: { ...data, draftRevision: { increment: 1 } },
    });
    return res.count === 1;
  }

  /** Ownership and the confirmed name are part of the DELETE condition itself (no check-then-act gap). */
  async deleteConfirmed(storeId: string, confirmedName: string) {
    const res = await this.client.store.deleteMany({
      where: { id: storeId, ownerId: this.ownerId, name: confirmedName },
    });
    return res.count === 1;
  }
}
