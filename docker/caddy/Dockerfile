# Custom Caddy (decision I-2): wildcard certificates for <store>.<root domain> need the ACME DNS-01 challenge, which needs the
# DNS provider's module compiled in. The provider is chosen in phase 14, so the module is a BUILD ARGUMENT:
#   docker build --build-arg DNS_MODULE=github.com/caddy-dns/<provider> docker/caddy
# With no module (the default) the image is plain Caddy: enough for local/CI tests with `tls internal`, NOT for production wildcards.
ARG CADDY_BUILDER=caddy:2.10-builder@sha256:01668408cc26e2e00c9d067c30cb43b2ba14ad1f2808beda55503cb2a31f59dc
ARG CADDY_RUNTIME=caddy:2.10@sha256:c3d7ee5d2b11f9dc54f947f68a734c84e9c9666c92c88a7f30b9cba5da182adb

FROM ${CADDY_BUILDER} AS builder
ARG DNS_MODULE=
RUN xcaddy build ${DNS_MODULE:+--with ${DNS_MODULE}}

FROM ${CADDY_RUNTIME}
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY tls.d /etc/caddy/tls.d
RUN APP_ROOT_DOMAIN=example.test caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
