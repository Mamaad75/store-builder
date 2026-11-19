import { validateSubdomain } from "@/lib/hostname";
import { db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/modules/stores/errors";
import { StoreLockBusyError, withStoreLock } from "@/modules/stores/mutation";
import { parseStoreId } from "@/modules/stores/service";
import { MAX_RESERVED_SUBDOMAINS_PER_STORE } from "./constants";
import { ConfirmationRequiredError, PublishBusyError, ReservedLabelLimitError, SubdomainReservedError, SubdomainTakenError } from "./errors";

/** A reservation blocks until its end; at exactly `reservedUntil` the label is available again. */
export const isReservationActive = (reservedUntil: Date, now: Date): boolean => reservedUntil.getTime() > now.getTime();

const LABEL_ERRORS = { invalid: "نام زیردامنه نامعتبر است (۳ تا ۳۰ حرف انگلیسی کوچک، عدد یا خط تیره)", reserved: "این نام برای سامانه رزرو شده است" };

interface ReservationRow {
  host: string;
  previousStoreId: string;
  reservedUntil: Date;
  active: boolean;
}

/** `active` is evaluated by the database clock, the same clock the triggers use. */
const reservationOf = (host: string): Promise<ReservationRow[]> =>
  db.$queryRaw<ReservationRow[]>`SELECT "host", "previousStoreId", "reservedUntil", ("reservedUntil" > now()) AS "active" FROM "SubdomainReservation" WHERE "host" = ${host}`;

/**
 * Claims a subdomain for the store, or changes it. One subdomain per store.
 *  - a LIVE store needs `confirmChange: true` to change it (the old address stops working at once, with no redirect)
 *  - the old label is released by deleting its Domain row; a trigger reserves it for 30 days
 *  - a label under an active reservation can only be taken by the store that released it
 *  - a store may hold at most 3 released-but-reserved labels; reclaiming one of its own does not add to that count
 * The Domain triggers re-check the reservation under a per-host advisory lock, so a race cannot slip a claim through.
 */
export async function claimSubdomain(ownerId: string, storeId: unknown, input: { label: unknown; confirmChange?: unknown }): Promise<{ label: string; changed: boolean }> {
  const sid = parseStoreId(storeId);
  const check = validateSubdomain(typeof input.label === "string" ? input.label : "");
  if (!check.ok) throw new ValidationError({ label: [LABEL_ERRORS[check.reason]] });
  const label = check.value;
  const confirm = input.confirmChange === true || input.confirmChange === "true" || input.confirmChange === "on";

  try {
    const { value } = await withStoreLock(ownerId, sid, async (ctx) => {
      const current = await ctx.tx.domain.findFirst({ where: { storeId: sid, kind: "SUBDOMAIN" }, select: { id: true, host: true } });
      if (current?.host === label) return { label, changed: false };

      const other = await ctx.tx.domain.findFirst({ where: { kind: "SUBDOMAIN", host: label }, select: { id: true } });
      if (other) throw new SubdomainTakenError();
      const reserved = await ctx.tx.$queryRaw<ReservationRow[]>`SELECT "host", "previousStoreId", "reservedUntil", ("reservedUntil" > now()) AS "active" FROM "SubdomainReservation" WHERE "host" = ${label}`;
      const own = reserved[0] && reserved[0].active && reserved[0].previousStoreId === sid;
      if (reserved[0]?.active && !own) throw new SubdomainReservedError(reserved[0].reservedUntil);

      if (current) {
        if (ctx.store.status === "PUBLISHED" && !confirm) throw new ConfirmationRequiredError();
        const mine = await ctx.tx.$queryRaw<{ reservedUntil: Date }[]>`SELECT "reservedUntil" FROM "SubdomainReservation" WHERE "previousStoreId" = ${sid} AND "reservedUntil" > now() ORDER BY "reservedUntil" ASC`;
        if (mine.length >= MAX_RESERVED_SUBDOMAINS_PER_STORE && !own) throw new ReservedLabelLimitError(mine[0]!.reservedUntil, MAX_RESERVED_SUBDOMAINS_PER_STORE);
        await ctx.tx.domain.delete({ where: { id: current.id } }); // the trigger reserves the old label for 30 days
      }
      await ctx.tx.domain.create({ data: { storeId: sid, kind: "SUBDOMAIN", host: label, verifiedAt: new Date() } });
      return { label, changed: true };
    });
    return value;
  } catch (e) {
    throw await mapSubdomainFailure(e, label);
  }
}

async function mapSubdomainFailure(e: unknown, label: string): Promise<unknown> {
  if (e instanceof StoreLockBusyError) return new PublishBusyError();
  const msg = String((e as { message?: unknown } | null)?.message ?? "");
  if (msg.includes("SUBDOMAIN_RESERVED")) {
    const r = (await reservationOf(label))[0];
    return new SubdomainReservedError(r?.reservedUntil ?? new Date());
  }
  if ((e as { code?: string } | null)?.code === "P2002" || /Domain_kind_host_key|unique constraint/i.test(msg)) return new SubdomainTakenError();
  return e;
}

export interface SubdomainState {
  current: string | null;
  /** Labels this store released and still holds a reservation on. */
  reserved: { host: string; until: Date }[];
}

export async function getSubdomainState(ownerId: string, storeId: unknown): Promise<SubdomainState> {
  const sid = parseStoreId(storeId);
  const store = await db.store.findFirst({ where: { id: sid, ownerId }, select: { domains: { where: { kind: "SUBDOMAIN" }, select: { host: true } } } });
  if (!store) throw new NotFoundError();
  const rows = await db.$queryRaw<{ host: string; until: Date }[]>`SELECT "host", "reservedUntil" AS "until" FROM "SubdomainReservation" WHERE "previousStoreId" = ${sid} AND "reservedUntil" > now() ORDER BY "reservedUntil" ASC`;
  return { current: store.domains[0]?.host ?? null, reserved: rows };
}
