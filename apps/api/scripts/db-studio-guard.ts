/**
 * Pure safety rules for `pnpm db:studio` (Prisma Studio on the LOCAL development database). No I/O, so every rule is unit-tested
 * (src/lib/db-studio-guard.test.ts). The wrapper (scripts/db-studio.ts) only reads files/env and spawns the process.
 */

/** The only database hosts Studio may connect to: this machine, spelled exactly. (127.0.0.2, "localhost." and hostnames that merely start with these are refused.) */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Connection-string parameters that can redirect the connection to another host or a socket, whatever the authority says. */
const REDIRECTING_PARAMS = ["host", "hostaddr", "service", "socket", "servername"] as const;

export const STUDIO_HOSTNAME = "127.0.0.1"; // the interface Studio listens on: loopback only, not configurable
export const DEFAULT_STUDIO_PORT = "5555";

export type Checked<T> = ({ ok: true } & T) | { ok: false; reason: string };

export interface StudioEnvironment {
  NODE_ENV?: string | undefined;
  DATABASE_URL?: string | undefined;
}

/** Validates the environment and the database URL. Returns the URL (unchanged) and a password-masked form for display. */
export function checkStudioEnvironment(env: StudioEnvironment): Checked<{ url: string; masked: string }> {
  if (env.NODE_ENV === "production") return { ok: false, reason: "NODE_ENV is 'production'. Prisma Studio is for local development only." };
  const url = env.DATABASE_URL;
  if (!url) return { ok: false, reason: "DATABASE_URL is not set (environment, .env.local or .env). Copy .env.example to .env.local first." };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "DATABASE_URL is not a valid URL." };
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") return { ok: false, reason: "DATABASE_URL must be a postgresql:// URL." };
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    return { ok: false, reason: `DATABASE_URL points at '${parsed.hostname}', not at this machine. Only localhost / 127.0.0.1 / ::1 are allowed.` };
  }
  for (const key of parsed.searchParams.keys()) {
    if ((REDIRECTING_PARAMS as readonly string[]).includes(key.toLowerCase())) {
      return { ok: false, reason: `DATABASE_URL contains the '${key}' parameter, which can redirect the connection. Remove it.` };
    }
  }
  const masked = `${parsed.protocol}//${decodeURIComponent(parsed.username)}:***@${parsed.host}${parsed.pathname}`;
  return { ok: true, url, masked };
}

export interface StudioArgs {
  port: string;
  browser: string;
}

/** Only --port/-p and --browser/-b are accepted. The listening host cannot be changed (no --hostname/--host/-n). */
export function parseStudioArgs(argv: readonly string[]): Checked<StudioArgs> {
  const args = argv.filter((a) => a !== "--");
  let port = DEFAULT_STUDIO_PORT;
  let browser = "none";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--port" || a === "-p") {
      const v = args[++i];
      if (v === undefined) return { ok: false, reason: "--port needs a value" };
      port = v;
    } else if (a === "--browser" || a === "-b") {
      const v = args[++i];
      if (v === undefined) return { ok: false, reason: "--browser needs a value" };
      browser = v;
    } else {
      return { ok: false, reason: `unsupported argument '${a}' (allowed: --port, --browser). The host is fixed to ${STUDIO_HOSTNAME}.` };
    }
  }
  if (!/^\d{2,5}$/.test(port) || Number(port) < 10 || Number(port) > 65535) return { ok: false, reason: "--port must be a number between 10 and 65535." };
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(browser)) return { ok: false, reason: "--browser must be a plain browser name (or 'none')." };
  return { ok: true, port, browser };
}

export interface StudioCommand {
  command: string;
  args: string[];
  /** Variables set explicitly on top of the parent environment: the validated DATABASE_URL always wins over any .env file. */
  env: { DATABASE_URL: string };
  masked: string;
  port: string;
}

/** Builds the exact command to run, or the reason for refusing. This is the only place the Studio arguments are assembled. */
export function buildStudioCommand(env: StudioEnvironment, argv: readonly string[]): Checked<{ command: StudioCommand }> {
  const checked = checkStudioEnvironment(env);
  if (!checked.ok) return checked;
  const parsed = parseStudioArgs(argv);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    command: {
      command: "pnpm",
      args: ["exec", "prisma", "studio", "--hostname", STUDIO_HOSTNAME, "--port", parsed.port, "--browser", parsed.browser],
      env: { DATABASE_URL: checked.url },
      masked: checked.masked,
      port: parsed.port,
    },
  };
}

/** Minimal .env reader (KEY=VALUE, optional quotes, # comments). */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2] ?? "";
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]!] = v;
  }
  return out;
}
