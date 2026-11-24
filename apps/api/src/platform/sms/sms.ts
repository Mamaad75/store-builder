/**
 * SMS (phase 3.1, D31-2). One port, one adapter today: Kavenegar's OTP route `verify/lookup` (a template approved by the provider, sent on
 * its service lines). Rules:
 *  - the API key is part of the request PATH: no URL, key, code, phone or response body is ever logged or put into an error message;
 *  - https only (a loopback http base is allowed for tests), no redirects, a 5 s timeout;
 *  - errors are a fixed `SmsSendError(reason)`; the caller decides what the shopper sees.
 */
export interface SmsSender {
  /** Sends a one-time code to an Iranian mobile in E.164 form (+989xxxxxxxxx). Throws SmsSendError. */
  sendOtp(phoneE164: string, code: string): Promise<void>;
}

/** Phase 3.6: Kavenegar lookup tokens of a template (token/token2/token3: no spaces; token10: up to 5; token20: up to 8). */
export interface LookupTokens {
  token: string;
  token2?: string;
  token3?: string;
  token10?: string;
  token20?: string;
}

/** Phase 3.6 (D36-1): any approved verify/lookup template (order SMS), on the same account and line rules as the OTP. */
export interface TemplateSmsSender {
  /** Throws SmsSendError. */
  sendTemplate(phoneE164: string, template: string, tokens: LookupTokens): Promise<void>;
}

export interface KavenegarConfig {
  apiKey: string;
  template: string;
  apiBase: string;
  timeoutMs: number;
}

export class SmsSendError extends Error {
  /** server_error (5xx) is the only temporary failure; timeout/network may have been sent (never retried for order SMS: no doubles). */
  constructor(public readonly reason: "http_status" | "server_error" | "rejected" | "timeout" | "network" | "bad_response") {
    super(`sms not sent: ${reason}`);
    this.name = "SmsSendError";
  }
}

export class KavenegarSms implements SmsSender, TemplateSmsSender {
  constructor(
    private readonly c: KavenegarConfig,
    private readonly send: typeof fetch = fetch,
  ) {}

  async sendOtp(phoneE164: string, code: string): Promise<void> {
    await this.sendTemplate(phoneE164, this.c.template, { token: code });
  }

  async sendTemplate(phoneE164: string, template: string, tokens: LookupTokens): Promise<void> {
    // Kavenegar takes the national form (09xxxxxxxxx). The parameters travel in the POST body, not in the URL.
    const fields: Record<string, string> = { receptor: `0${phoneE164.slice(3)}`, template };
    for (const [k, v] of Object.entries(tokens)) if (typeof v === "string" && v !== "") fields[k] = v;
    const body = new URLSearchParams(fields);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.c.timeoutMs);
    let res: Response;
    try {
      res = await this.send(`${this.c.apiBase}/v1/${encodeURIComponent(this.c.apiKey)}/verify/lookup.json`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: ctrl.signal,
        redirect: "error",
      });
    } catch (e) {
      throw new SmsSendError(e instanceof Error && e.name === "AbortError" ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new SmsSendError(res.status >= 500 ? "server_error" : "http_status");
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new SmsSendError("bad_response");
    }
    const status = (json as { return?: { status?: unknown } })?.return?.status;
    if (status !== 200) throw new SmsSendError("rejected");
  }
}
