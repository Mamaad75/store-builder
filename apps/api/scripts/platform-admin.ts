import { PlatformService, PrismaPlatformRepository } from "../src/modules/platform/platform.api.js";
import { bootstrapJob } from "./bootstrap.js";
import { db } from "../src/lib/db.js";
import { createHash, randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { PilotAccessService } from "../src/modules/platform/application/pilot.service.js";
import { PrismaPilotRepository } from "../src/modules/platform/infrastructure/prisma-pilot.repository.js";

/**
 * Platform super admins from the SERVER (phase 3.1, D31-1): the only way to create the first one. Needs database access, so it runs where
 * the stack runs (e.g. `docker compose exec worker node_modules/.bin/tsx scripts/platform-admin.ts grant <username>`).
 *   pnpm platform:admin list
 *   pnpm platform:admin grant <username>
 *   pnpm platform:admin revoke <username>      (never the last super admin)
 *   pnpm platform:admin invite [note]          (MVP item 2: a single-use sign-up code, 7 days; how the first admin registers while
 *                                               registration is invite-only. Prints the code and the sign-up link ONCE.)
 * Audited with actor "server command" (actorId null). Prints usernames only.
 */
bootstrapJob({ storage: false });

async function main() {
  const [cmd, username] = process.argv.slice(2);
  const svc = new PlatformService(new PrismaPlatformRepository());
  if (cmd === "list") {
    for (const a of await svc.admins()) console.log(`${a.username}\t${a.role}\tsince ${a.grantedAt.toISOString()}`);
    return;
  }
  if (cmd === "invite") {
    const origin = `${process.env.APP_PROTOCOL ?? "http"}://${process.env.APP_ROOT_DOMAIN ?? "localhost:3000"}`;
    const pilot = new PilotAccessService(new PrismaPilotRepository(), {
      hashPassword,
      verifyPassword,
      limit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
      platformOrigin: origin,
      random: (bytes) => randomBytes(bytes).toString("base64url"),
      sha256: (v) => createHash("sha256").update(v, "utf8").digest("hex"),
    });
    const r = await pilot.createInvite(null, { note: (username ?? "server command").slice(0, 100) });
    console.log(`invite code: ${r.code}\nsign-up link: ${r.url}\nexpires: ${r.expiresAt.toISOString()}`);
    return;
  }
  if ((cmd === "grant" || cmd === "revoke") && username) {
    if (cmd === "grant") await svc.grant(null, { username });
    else {
      const user = await db.user.findUnique({ where: { username: username.trim().toLowerCase() }, select: { id: true } });
      if (!user) throw new Error("no such user");
      await svc.revoke(null, user.id);
    }
    console.log(`${cmd} ok: ${username.trim().toLowerCase()}`);
    return;
  }
  console.error("usage: platform-admin list | grant <username> | revoke <username> | invite [note]");
  process.exitCode = 2;
}
main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : "failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
