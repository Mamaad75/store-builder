/** Test database helpers (used by *.db.test.ts and the DB global setup only; never imported by application code). */
export function getDbUrls() {
  const admin = process.env.DATABASE_URL ?? "postgresql://storebuilder:storebuilder@localhost:5432/storebuilder";
  const test = new URL(admin);
  test.pathname = "/storebuilder_api_test";
  return { admin, test: test.toString() };
}
