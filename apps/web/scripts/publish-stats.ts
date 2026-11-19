import { db } from "../src/lib/db";

/**
 * Read-only publishing statistics for capacity and WAL planning (docs/publishing.md). Prints counts and sizes only: no
 * store names, owner data or snapshot content. Safe to run against any environment the operator already has access to.
 */
async function main() {
  const [totals] = await db.$queryRaw<{ versions: bigint; bytes: bigint | null; stores: bigint; avg: number | null; max: number | null }[]>`
    SELECT count(*) AS versions, sum("snapshotBytes") AS bytes, count(DISTINCT "storeId") AS stores, avg("snapshotBytes")::float AS avg, max("snapshotBytes") AS max
    FROM "StoreVersion"`;
  const perStore = await db.$queryRaw<{ n: bigint; bytes: bigint }[]>`SELECT count(*) AS n, sum("snapshotBytes") AS bytes FROM "StoreVersion" GROUP BY "storeId" ORDER BY sum("snapshotBytes") DESC LIMIT 5`;
  const [slugs] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "PublishedSlug"`;
  const [res] = await db.$queryRaw<{ active: bigint; expired: bigint }[]>`
    SELECT count(*) FILTER (WHERE "reservedUntil" > now()) AS active, count(*) FILTER (WHERE "reservedUntil" <= now()) AS expired FROM "SubdomainReservation"`;
  const [live] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Store" WHERE "status" = 'PUBLISHED'`;
  const mib = (b: bigint | number | null) => (Number(b ?? 0) / 1048576).toFixed(2);
  console.log(
    JSON.stringify(
      {
        liveStores: Number(live!.n),
        versions: Number(totals!.versions),
        storesWithVersions: Number(totals!.stores),
        totalSnapshotMiB: mib(totals!.bytes),
        avgSnapshotKiB: ((totals!.avg ?? 0) / 1024).toFixed(1),
        maxSnapshotMiB: mib(totals!.max),
        largestStoresByVersionBytes: perStore.map((s) => ({ versions: Number(s.n), MiB: mib(s.bytes) })),
        publishedSlugRows: Number(slugs!.n),
        subdomainReservations: { active: Number(res!.active), expiredNotYetReused: Number(res!.expired) },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
