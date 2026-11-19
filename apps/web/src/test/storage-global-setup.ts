import dbSetup from "./db-global-setup";
import { ensureTestBucket, getTestStorageEnv } from "./storage-env";

/** Fresh isolated database (like the DB suite) plus the isolated test bucket. */
export default async function setup() {
  await dbSetup();
  await ensureTestBucket(getTestStorageEnv("test"));
}
