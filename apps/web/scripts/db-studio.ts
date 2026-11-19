// Starts Prisma Studio against the LOCAL development database only, bound to 127.0.0.1.
//   pnpm db:studio            -> http://localhost:5555
//   pnpm db:studio -- --port 5556
// All safety rules live in scripts/db-studio-guard.ts (unit-tested). The URL is printed with the password masked.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { buildStudioCommand, parseEnvFile } from "./db-studio-guard";

const fromFile = (path: string): string | undefined => (existsSync(path) ? parseEnvFile(readFileSync(path, "utf8")).DATABASE_URL : undefined);
// Real environment first, then .env.local, then .env (the Prisma CLI itself reads only .env).
const DATABASE_URL = process.env.DATABASE_URL ?? fromFile(".env.local") ?? fromFile(".env");

const built = buildStudioCommand({ NODE_ENV: process.env.NODE_ENV, DATABASE_URL }, process.argv.slice(2));
if (!built.ok) {
  console.error(`db:studio refused to start: ${built.reason}`);
  process.exit(1);
}
const { command, args, env, masked, port } = built.command;
console.log(`Prisma Studio -> http://localhost:${port}  (bound to 127.0.0.1 only)\nDatabase: ${masked}\nStop with Ctrl+C.`);
const child = spawn(command, args, { stdio: "inherit", env: { ...process.env, ...env } });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
