// D-E2E-PAY (MVP roadmap §12.1): a LOOPBACK-ONLY fake of the Zarinpal v4 paths the API adapter uses. Test-only; moves no money.
// It is started by playwright.config.ts for the isolated payments stack, whose API runs with NODE_ENV=test (the only mode in which
// ZARINPAL_DEV_BASE_URL is accepted, apps/api/src/config/env.ts). It accepts ONE fixed test merchant id.
//
//   POST /pg/v4/payment/request.json  -> code 100 + a sandbox authority ("S" + 35 letters/digits)
//   GET  /pg/StartPay/:authority      -> a small page with "pay" and "cancel" links back to the store's callback
//   GET  /pg/StartPay/:authority/pay  -> marks the session paid, redirects to callback?Authority=..&Status=OK
//   GET  /pg/StartPay/:authority/cancel -> redirects to callback?Authority=..&Status=NOK
//   POST /pg/v4/payment/verify.json   -> 100 (first time) / 101 (again) only if paid and the amount matches; -51 if not paid; -50 on amount mismatch
//   POST /pg/v4/payment/inquiry.json  -> status of the session
//   GET  /health
//
// Usage: node fake-zarinpal.mjs <port> <merchantId> <allowedCallbackHostSuffix>
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const [port, merchantId, callbackSuffix] = process.argv.slice(2);
if (!port || !merchantId || !callbackSuffix) throw new Error("usage: fake-zarinpal.mjs <port> <merchantId> <callbackHostSuffix>");

/** authority -> { amount, callback, paid, verified } */
const sessions = new Map();
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const newAuthority = () => "S" + Array.from(randomBytes(35), (b) => ALNUM[b % ALNUM.length]).join("");

const json = (res, status, body) => {
  // One line per answer (no request bodies): enough to diagnose a failing E2E run from the WebServer output.
  console.error(`[fake-zarinpal] ${res.req.method} ${new URL(res.req.url, "http://x").pathname} -> ${status} code=${body?.data?.code ?? body?.errors?.code ?? "-"}`);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const fail = (res, code) => json(res, 200, { data: [], errors: { code, message: "fake error", validations: [] } });

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw new Error("too large");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function callbackAllowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" && u.host.endsWith(callbackSuffix);
  } catch {
    return false;
  }
}

const back = (s, authority, status) => {
  const u = new URL(s.callback);
  u.searchParams.set("Authority", authority);
  u.searchParams.set("Status", status);
  return u.toString();
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });

    if (req.method === "POST" && url.pathname === "/pg/v4/payment/request.json") {
      const b = await readJson(req);
      if (b.merchant_id !== merchantId) return fail(res, -11); // merchant not found / inactive
      if (!Number.isInteger(b.amount) || b.amount < 1000 || b.currency !== "IRR") return fail(res, -9);
      if (!callbackAllowed(b.callback_url)) return fail(res, -14); // callback domain does not match the merchant's
      const authority = newAuthority();
      sessions.set(authority, { amount: b.amount, callback: b.callback_url, paid: false, verified: false });
      return json(res, 200, { data: { code: 100, message: "Success", authority, fee_type: "Merchant", fee: 0 }, errors: [] });
    }

    const start = /^\/pg\/StartPay\/([AS][0-9A-Za-z]{35})(?:\/(pay|cancel))?$/.exec(url.pathname);
    if (req.method === "GET" && start) {
      const [, authority, action] = start;
      const s = sessions.get(authority);
      if (!s) return json(res, 404, { error: "unknown authority" });
      if (action === "pay") {
        s.paid = true;
        res.writeHead(302, { location: back(s, authority, "OK") });
        return res.end();
      }
      if (action === "cancel") {
        res.writeHead(302, { location: back(s, authority, "NOK") });
        return res.end();
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(
        `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>درگاه آزمایشی</title>` +
          `<h1>درگاه آزمایشی (فقط آزمون)</h1><p>مبلغ: <span id="amount">${s.amount}</span> ریال</p>` +
          `<a id="pay" href="/pg/StartPay/${authority}/pay">پرداخت آزمایشی</a> <a id="cancel" href="/pg/StartPay/${authority}/cancel">انصراف</a></html>`,
      );
    }

    if (req.method === "POST" && url.pathname === "/pg/v4/payment/verify.json") {
      const b = await readJson(req);
      if (b.merchant_id !== merchantId) return fail(res, -11);
      const s = sessions.get(b.authority);
      if (!s) return fail(res, -54); // invalid authority
      if (b.amount !== s.amount) return fail(res, -50); // amount mismatch
      if (!s.paid) return fail(res, -51); // not paid
      const code = s.verified ? 101 : 100;
      s.verified = true;
      return json(res, 200, { data: { code, message: "Verified", card_hash: "x", card_pan: "603799******7893", ref_id: 201, fee_type: "Merchant", fee: 0 }, errors: [] });
    }

    if (req.method === "POST" && url.pathname === "/pg/v4/payment/inquiry.json") {
      const b = await readJson(req);
      const s = b.merchant_id === merchantId ? sessions.get(b.authority) : undefined;
      if (!s) return fail(res, -54);
      return json(res, 200, { data: { code: 100, message: "Success", status: s.verified ? "VERIFIED" : s.paid ? "PAID" : "IN_BANK" }, errors: [] });
    }

    json(res, 404, { error: "not found" });
  } catch {
    json(res, 400, { error: "bad request" });
  }
}).listen(Number(port), "127.0.0.1"); // loopback only: never reachable from outside the machine / CI job
