import dbSetup from "./db-global-setup.js";
import { ensureTestBucket, getTestStorageEnv } from "./storage-env.js";

/** Fresh isolated database (like the DB suite) plus the isolated test bucket. */
export default async function setup() {
  await dbSetup();
  await ensureTestBucket(getTestStorageEnv("test"));
}
