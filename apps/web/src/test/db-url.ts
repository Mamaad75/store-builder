/** Test DB URL is always the dev server with the database name forced to `storebuilder_test`. */
export function getDbUrls() {
  const admin = process.env.DATABASE_URL ?? "postgresql://storebuilder:storebuilder@localhost:5432/storebuilder";
  const test = new URL(admin);
  test.pathname = "/storebuilder_test";
  return { admin, test: test.toString() };
}
