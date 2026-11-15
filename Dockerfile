# syntax=docker/dockerfile:1.7
#
# Production images for the platform (phase 13). Three targets from one file:
#   runtime  (default)  the Next.js standalone server: no pnpm, no dev dependencies, non-root, health check.
#   jobs                the same code with the full toolchain, for one-off and scheduled commands:
#                       migrations + seed (`pnpm db:deploy && pnpm db:seed`), media/db cleanup, the scheduler.
#   (build, deps)       intermediate stages.
# The base image is pinned by tag AND digest (refresh both together; Dependabot's docker ecosystem proposes updates).
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee

FROM ${NODE_IMAGE} AS os
# openssl: Prisma's query engine; ca-certificates: TLS to the object store and mail provider.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM os AS base
RUN npm install -g pnpm@10.28.0 && npm cache clean --force

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm db:generate && pnpm build

FROM deps AS jobs
ENV NODE_ENV=production
COPY prisma ./prisma
COPY scripts ./scripts
COPY src ./src
COPY tsconfig.json ./
RUN pnpm db:generate && chown -R node:node /app
USER node
CMD ["pnpm", "media:cleanup"]

FROM os AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
# The platform answers only on its configured root domain, so the probe sends that Host header (http.get: fetch() cannot override Host).
HEALTHCHECK --interval=15s --timeout=4s --start-period=25s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT,path:'/api/health',headers:{host:process.env.APP_ROOT_DOMAIN}},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
# Docker sets HOSTNAME to the container id at run time, which would make Next bind to that one interface only (and fail the health check on
# 127.0.0.1); the shell form pins the bind address to all interfaces, `exec` keeps node as PID 1 so it receives SIGTERM.
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec node server.js"]
