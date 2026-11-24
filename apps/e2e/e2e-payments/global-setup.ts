import { PAY_DATABASE_URL } from "../playwright.payments.config";
import { resetDatabase } from "../e2e/global-setup";

/** D-E2E-PAY: the payments stack's own "_e2e" database only (the main suite's database is not touched). */
export default async function globalSetup() {
  await resetDatabase(PAY_DATABASE_URL);
}
