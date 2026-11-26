const LABEL_RE = /^[a-z0-9-]{1,63}$/;
/** Crawlers, link previews and automation: not shoppers. A deliberately short, conservative list (no per-bot upkeep). */
const BOT_RE = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|curl|wget|python-requests|httpclient|monitor|uptime/i;

/** Page views per network per store per hour; beyond it views are silently dropped (the shopper is never told). */
export const VISIT_RULE = { limit: 600, windowSeconds: 3600 } as const;
/** The browser string is cut here before it is used. */
export const MAX_USER_AGENT = 300;

export const isStoreLabel = (v: unknown): v is string => typeof v === "string" && LABEL_RE.test(v);

export interface VisitInput {
  ip: string;
  userAgent: string;
  /** The browser sent "Do Not Track" or "Global Privacy Control". */
  doNotTrack: boolean;
}

/** Whether a page view may be counted at all (before the store is looked up): not tracked-opt-out, not a bot, has a browser string. */
export function isCountable(v: VisitInput): boolean {
  if (v.doNotTrack) return false;
  const ua = v.userAgent.slice(0, MAX_USER_AGENT);
  return ua.length > 0 && !BOT_RE.test(ua);
}

/**
 * What is hashed to recognise "the same visitor again today": the server secret, the Tehran day, the store, the address and the browser.
 * Changing any of them (another day, another store) gives an unrelated value, so a visitor cannot be followed across days or stores.
 */
export const visitorKey = (secret: string, day: string, storeId: string, v: VisitInput): string => `${secret}|${day}|${storeId}|${v.ip}|${v.userAgent.slice(0, MAX_USER_AGENT)}`;
