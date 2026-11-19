import { ensureTestBucket, getTestStorageEnv } from "../src/test/storage-env.js";

// CI only: creates the isolated, anonymous-read-only test bucket on the throw-away S3 server of the container smoke test.
ensureTestBucket(getTestStorageEnv("test"))
  .then(() => console.log("bucket ready"))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
