# Deployment notes

## Reverse proxy and client IP (rate limiting)

Login and registration rate limits use the client IP. A client can send any `X-Forwarded-For`
(XFF) value it likes, so the application **never trusts forwarding headers by default**.

| Variable | Default | Meaning |
|---|---|---|
| `TRUST_PROXY_HEADERS` | `false` | If not exactly `true`, all requests share one `unknown` IP bucket (the per-email limit still protects accounts, but one noisy client can exhaust the shared IP budget). |
| `TRUSTED_PROXY_HOPS` | `1` | Number of trusted proxies in front of the app. |

How the IP is chosen: XFF is read **from the right**. Each trusted proxy appends the address it
received the connection from, so with `N` trusted proxies the real client is the `N`-th entry
from the end. Anything to the left is client-controlled and ignored. Values that are not valid IP
addresses fall back to `unknown`. This is covered by unit tests and an E2E test that rotates a
spoofed left-hand entry.

Requirements before setting `TRUST_PROXY_HEADERS=true`:

1. **The app must not be reachable except through the proxy** (firewall / private network /
   security group). Otherwise a client can connect directly and send a forged header, which would
   be taken at face value.
2. The proxy must **append** the connecting address to XFF (or overwrite the header). Do not
   configure it to pass the client's header through unchanged.
3. `TRUSTED_PROXY_HOPS` must equal the number of proxies you control in the chain
   (e.g. CDN + load balancer = `2`). Too small a value would pick a proxy's address; too large a
   value falls back to `unknown` when the chain is shorter than expected.

Examples (conceptual; verify against your proxy's documentation):

- **nginx**: `proxy_set_header X-Forwarded-For $remote_addr;` (overwrites; hops = 1) or
  `$proxy_add_x_forwarded_for` (appends; hops = 1).
- **Caddy**: `reverse_proxy` appends the client address by default; set `trusted_proxies` only for
  upstream proxies you control.
- **Platform hosts (e.g. Vercel, Cloudflare)**: they set/overwrite the header themselves, but still
  check what a CDN in front adds and set `TRUSTED_PROXY_HOPS` accordingly.

Also required in production: HTTPS only (Auth.js uses the `__Secure-` cookie prefix when the
request is HTTPS), `AUTH_SECRET` generated with `openssl rand -base64 32`, `AUTH_TRUST_HOST=true`
only when the app is behind a proxy that sets the correct `Host`.

## Rate-limit table cleanup

`RateLimitBucket` rows are fixed windows: an expired row is already harmless for correctness
(the next hit resets it), so cleanup only bounds table size. Strategy:

1. **Opportunistic, bounded:** the limiter deletes rows that expired more than 1 hour ago, at most
   once per 5 minutes per process, in batches of 1000 (`FOR UPDATE SKIP LOCKED`, so concurrent
   instances never block each other or live traffic).
2. **Scheduled job (recommended in production):** run `pnpm db:cleanup` from cron or your
   platform scheduler (e.g. every 15 minutes). It drains up to 1000 batches per run. Alternatively
   use `pg_cron` with the same `DELETE`.
3. Growth is bounded by traffic: keys are hashed per IP/email and only created by requests that
   passed Zod validation (login/registration) and are removed an hour after their window ends.

If you switch to a Redis backend, key expiry (`EXPIRE`) replaces this job.
