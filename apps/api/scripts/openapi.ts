import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildOpenApi } from "@store-builder/shared/api/openapi";

/** Writes docs/api/openapi.json from the API contract (phase 2.5). A test fails while the committed file is out of date. */
const out = join(import.meta.dirname, "../../../docs/api/openapi.json");
writeFileSync(out, `${JSON.stringify(buildOpenApi(), null, 2)}\n`);
console.info(`openapi: wrote ${out}`);
