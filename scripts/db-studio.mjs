// Starts Prisma Studio against the LOCAL development database only, bound to 127.0.0.1.
//   pnpm db:studio            -> http://localhost:5555
//   pnpm db:studio -- --port 5556
// Safety: refuses to start unless DATABASE_URL points at this machine (localhost / 127.0.0.1 / ::1), and never listens
// on anything but the loopback interface. It does not write the URL anywhere and prints it with the password masked.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Minimal .env reader (KEY=VALUE, optional quotes, # comments). Real environment variables always win. */
function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || m[1] === undefined || line.trim().startsWith("#")) continue;
    let v = m[2] ?? "";
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const fail = (msg) => {
  console.error(`db:studio refused to start: ${msg}`);
  process.exit(1);
};

if (process.env.NODE_ENV === "production") fail("NODE_ENV is 'production'. Prisma Studio is for local development only.");

const url = process.env.DATABASE_URL ?? readEnvFile(".env.local").DATABASE_URL ?? readEnvFile(".env").DATABASE_URL;
if (!url) fail("DATABASE_URL is not set (environment, .env.local or .env). Copy .env.example to .env.local first.");

let parsed;
try {
  parsed = new URL(url);
} catch {
  fail("DATABASE_URL is not a valid URL.");
}
if (!/^postgres(ql)?:$/.test(parsed.protocol)) fail("DATABASE_URL must be a postgresql:// URL.");
if (!LOCAL_HOSTS.has(parsed.hostname)) {
  fail(`DATABASE_URL points at '${parsed.hostname}', not at this machine. Only localhost / 127.0.0.1 / ::1 are allowed.`);
}
const masked = `${parsed.protocol}//${decodeURIComponent(parsed.username)}:***@${parsed.host}${parsed.pathname}`;

// Extra arguments are limited to --port/-p and --browser/-b; the hostname is always loopback.
const extra = process.argv.slice(2).filter((a) => a !== "--");
let port = "5555";
let browser = "none";
for (let i = 0; i < extra.length; i++) {
  const a = extra[i];
  if (a === "--port" || a === "-p") port = extra[++i] ?? fail("--port needs a value");
  else if (a === "--browser" || a === "-b") browser = extra[++i] ?? fail("--browser needs a value");
  else fail(`unsupported argument '${a}' (allowed: --port, --browser). The host is fixed to 127.0.0.1.`);
}
if (!/^\d{2,5}$/.test(port) || Number(port) > 65535) fail("--port must be a number between 10 and 65535.");

console.log(`Prisma Studio -> http://localhost:${port}  (bound to 127.0.0.1 only)\nDatabase: ${masked}\nStop with Ctrl+C.`);
const child = spawn("pnpm", ["exec", "prisma", "studio", "--hostname", "127.0.0.1", "--port", port, "--browser", browser], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
