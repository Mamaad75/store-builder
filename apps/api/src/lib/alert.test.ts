import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AlertConfigError, AlertSendError, createNotifier, formatAlert, readAlertConfig, sendAlert, type AlertConfig } from "./alert.js";

/** Alerts through a Bale bot (D14-3, phase 14 K4). A local HTTP server plays Bale: no real network, no real token. */
const TOKEN = "123456789:test-only-token-abcdefgh";
let server: Server;
let base = "";
let mode: "ok" | "rejected" | "http500" | "hang" = "ok";
const received: { path: string; body: string; contentType: string }[] = [];

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    received.push({ path: req.url ?? "", body, contentType: String(req.headers["content-type"] ?? "") });
    if (mode === "hang") return; // never answers
    if (mode === "http500") return void res.writeHead(500).end("boom " + TOKEN);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(mode === "ok" ? { ok: true, result: { message_id: 1 } } : { ok: false, error_code: 400, description: "chat not found" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  mode = "ok";
  received.length = 0;
});

const cfg = (over: Partial<AlertConfig> = {}): AlertConfig => ({ token: TOKEN, chatId: "-1001234", apiBase: base, timeoutMs: 2_000, source: "shop.example.ir", ...over });

describe("alert configuration", () => {
  it("both variables unset means alerts are off; the default API is https://tapi.bale.ai", () => {
    expect(readAlertConfig({})).toBeNull();
    expect(readAlertConfig({ BALE_BOT_TOKEN: " ", BALE_CHAT_ID: "" })).toBeNull();
    expect(readAlertConfig({ BALE_BOT_TOKEN: TOKEN, BALE_CHAT_ID: "@ops_channel", APP_ROOT_DOMAIN: "shop.example.ir" })).toMatchObject({ apiBase: "https://tapi.bale.ai", chatId: "@ops_channel", source: "shop.example.ir" });
  });
  it("half or malformed configuration is refused, naming variables only (never the token)", () => {
    for (const env of [{ BALE_BOT_TOKEN: TOKEN }, { BALE_CHAT_ID: "123" }, { BALE_BOT_TOKEN: "not-a-token", BALE_CHAT_ID: "123" }, { BALE_BOT_TOKEN: TOKEN, BALE_CHAT_ID: "chat id!" }]) {
      let err: unknown;
      try {
        readAlertConfig(env);
      } catch (e) {
        err = e;
      }
      expect(err, JSON.stringify(Object.keys(env))).toBeInstanceOf(AlertConfigError);
      expect((err as Error).message).not.toContain(TOKEN);
    }
  });
  it("the API base must be https; plain http is accepted only on loopback (tests)", () => {
    expect(() => readAlertConfig({ BALE_BOT_TOKEN: TOKEN, BALE_CHAT_ID: "1", BALE_API_BASE: "http://tapi.bale.ai" })).toThrow(/BALE_API_BASE/);
    expect(readAlertConfig({ BALE_BOT_TOKEN: TOKEN, BALE_CHAT_ID: "1", BALE_API_BASE: "http://127.0.0.1:9999/" })?.apiBase).toBe("http://127.0.0.1:9999");
  });
});

describe("formatting", () => {
  it("names the source and event, redacts sensitive fields by name, and stays within Bale's 4096-character limit", () => {
    const text = formatAlert("shop.example.ir", "job.failed", { job: "media-cleanup", exitCode: 2, email: "a@b.ir", token: "x", link: "https://x" });
    expect(text).toContain("shop.example.ir");
    expect(text).toContain("job.failed");
    expect(text).toContain("job: media-cleanup");
    expect(text).toContain("exitCode: 2");
    for (const secret of ["a@b.ir", "https://x"]) expect(text).not.toContain(secret);
    expect(formatAlert("s", "e", { note: "x".repeat(10_000) }).length).toBeLessThanOrEqual(4096);
  });
});

describe("sending (local fake Bale)", () => {
  it("POSTs JSON {chat_id, text} to /bot<token>/sendMessage; numeric chat ids are sent as numbers", async () => {
    await sendAlert(cfg(), "سلام");
    expect(received).toHaveLength(1);
    expect(received[0]!.path).toBe(`/bot${TOKEN}/sendMessage`);
    expect(received[0]!.contentType).toContain("application/json");
    expect(JSON.parse(received[0]!.body)).toEqual({ chat_id: -1001234, text: "سلام" });
  });
  it("an API rejection, an HTTP error and a timeout are typed errors whose messages never contain the token or the URL", async () => {
    for (const [m, reason] of [["rejected", "api_rejected"], ["http500", "http_status"], ["hang", "timeout"]] as const) {
      mode = m;
      let err: unknown;
      try {
        await sendAlert(cfg({ timeoutMs: 300 }), "x");
      } catch (e) {
        err = e;
      }
      expect(err, m).toBeInstanceOf(AlertSendError);
      expect((err as Error).message).toContain(reason);
      expect((err as Error).message).not.toContain(TOKEN);
      expect((err as Error).message).not.toContain("127.0.0.1");
    }
  });
  it("the notifier never throws: delivery problems become one alert.failed log line without token or URL", async () => {
    mode = "rejected";
    const lines: string[] = [];
    await expect(createNotifier(cfg(), { write: (l) => lines.push(l) })("job.failed", { job: "db-cleanup" })).resolves.toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: "error", event: "alert.failed", errorClass: "AlertSendError" });
    expect(lines[0]).not.toContain(TOKEN);
    expect(lines[0]).not.toContain(base);
  });
  it("without configuration the notifier only logs alert.disabled and sends nothing", async () => {
    const lines: string[] = [];
    await createNotifier(null, { write: (l) => lines.push(l) })("job.failed", {});
    expect(received).toHaveLength(0);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "alert.disabled" });
  });
});

describe("scripts/notify-bale.sh (host-side alerts, e.g. the backup failure hook)", () => {
  const script = path.resolve(import.meta.dirname, "../../../../scripts/notify-bale.sh"); // repository-root operations script (apps/web/src/lib -> root)
  // Asynchronous spawn: the fake Bale server runs in THIS process, so a synchronous spawn would block it from answering.
  const run = (env: Record<string, string>, args = ["پشتیبان‌گیری شکست خورد"]) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn("bash", [script, ...args], { env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });

  it("sends form-encoded chat_id and text to /bot<token>/sendMessage and logs alert.sent; the token never appears in its output", async () => {
    const r = await run({ BALE_BOT_TOKEN: TOKEN, BALE_CHAT_ID: "-1001234", BALE_API_BASE: base, APP_ROOT_DOMAIN: "shop.example.ir" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('"event":"alert.sent"');
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
    expect(received[0]!.path).toBe(`/bot${TOKEN}/sendMessage`);
    const form = new URLSearchParams(received[0]!.body);
    expect(form.get("chat_id")).toBe("-1001234");
    expect(form.get("text")).toContain("shop.example.ir");
    expect(form.get("text")).toContain("پشتیبان‌گیری شکست خورد");
  });
  it("rejections fail with exit 1 (alert.failed), invalid settings with exit 2, and no settings at all is a no-op", async () => {
    mode = "rejected";
    const rejected = await run({ BALE_BOT_TOKEN: TOKEN, BALE_CHAT_ID: "1", BALE_API_BASE: base });
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('"reason":"api_rejected"');
    expect(rejected.stderr).not.toContain(TOKEN);
    expect((await run({ BALE_BOT_TOKEN: TOKEN, BALE_CHAT_ID: "1", BALE_API_BASE: "http://evil.example" })).status).toBe(2);
    const disabled = await run({});
    expect(disabled.status).toBe(0);
    expect(disabled.stderr).toContain('"event":"alert.disabled"');
  });
});
