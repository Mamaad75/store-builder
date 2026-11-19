import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { testConfig } from "./helpers.js";

// Runs against the isolated test database (vitest.db.config.ts); needs a reachable PostgreSQL.
const url = process.env.DATABASE_URL!;
describe("readiness against a real PostgreSQL", () => {
  it("is ready with a good URL and 503 with an unreachable database, without leaking the URL", async () => {
    const good = await createApp({ ...testConfig, databaseUrl: url! });
    await good.listen(0, "127.0.0.1");
    const goodUrl = (await good.getUrl()).replace("[::1]", "127.0.0.1");
    const ok = await fetch(`${goodUrl}/api/ready`);
    expect(ok.status).toBe(200);
    await good.close();

    const bad = await createApp({ ...testConfig, databaseUrl: "postgresql://nobody:SECRETPW@127.0.0.1:1/none?connect_timeout=1" });
    await bad.listen(0, "127.0.0.1");
    const badUrl = (await bad.getUrl()).replace("[::1]", "127.0.0.1");
    const down = await fetch(`${badUrl}/api/ready`);
    const text = await down.text();
    expect(down.status).toBe(503);
    expect(text).not.toContain("SECRETPW");
    await bad.close();
  });
});
