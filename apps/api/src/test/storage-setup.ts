import { getStorageConfig } from "../lib/storage/config.js";
import { configureStorage } from "../lib/storage/index.js";

// The storage test suites get their (isolated, local) S3 settings from the environment set in vitest.storage.config.ts.
configureStorage(getStorageConfig(process.env));
