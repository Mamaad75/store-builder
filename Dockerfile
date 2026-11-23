# syntax=docker/dockerfile:1.7
#
# Production images for the platform (phase 13). Three targets from one file:
#   runtime  (default)  the Next.js standalone server: no pnpm, no dev dependencies, non-root, health check.
#   jobs                the same code with the full toolchain, for one-off and scheduled commands:
#                       migrations + seed (`pnpm db:deploy && pnpm db:seed`), media/db cleanup, the scheduler.
#   api                 the NestJS API (ADR 0001, N2): compiled JS + production dependencies only, non-root, health check.
#   (build, deps)       intermediate stages.
# pnpm workspace (ADR 0001): the build context is the repository root; apps/web = UI, apps/api = backend, packages/shared = shared code.
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
# Only the manifests first, so dependency installation is cached until a manifest or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY apps/e2e/package.json ./apps/e2e/
COPY packages/shared/package.json ./packages/shared/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# The web app is UI only: no Prisma client, no database access. It imports the compiled shared package.
RUN pnpm shared:build && pnpm --filter @store-builder/web build

FROM deps AS jobs
# The API image with the full toolchain, for one-off and scheduled commands (ADR 0001): migrations + seed (`pnpm db:deploy && pnpm db:seed`),
# media/db cleanup and the scheduler. The schema, migrations, seed and job scripts belong to the API.
ENV NODE_ENV=production
COPY packages/shared ./packages/shared
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/scripts ./apps/api/scripts
COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json ./apps/api/
RUN pnpm shared:build
WORKDIR /app/apps/api
RUN pnpm db:generate && chown -R node:node /app
USER node
CMD ["pnpm", "media:cleanup"]

FROM os AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
# The standalone bundle mirrors the workspace: /app/apps/web/server.js plus the traced /app/node_modules.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
WORKDIR /app/apps/web
USER node
EXPOSE 3000
# The platform answers only on its configured root domain, so the probe sends that Host header (http.get: fetch() cannot override Host).
HEALTHCHECK --interval=15s --timeout=4s --start-period=25s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT,path:'/api/health',headers:{host:process.env.APP_ROOT_DOMAIN}},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
# Docker sets HOSTNAME to the container id at run time, which would make Next bind to that one interface only (and fail the health check on
# 127.0.0.1); the shell form pins the bind address to all interfaces, `exec` keeps node as PID 1 so it receives SIGTERM.
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec node server.js"]

# ---- NestJS API (ADR 0001) ----
FROM deps AS api-build
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
# The Prisma client is generated from the API's schema, the shared package and the API are compiled.
RUN pnpm shared:build && pnpm --filter @store-builder/api db:generate && pnpm --filter @store-builder/api build
# A self-contained production tree (no dev dependencies, no sources), plus the generated client and its query engine.
RUN pnpm --filter @store-builder/api deploy --legacy --prod /out \
 && SRC="$(readlink -f apps/api/node_modules/@prisma/client)/../../.prisma/client" \
 && DST="$(readlink -f /out/node_modules/@prisma/client)/../../.prisma/client" \
 && mkdir -p "${DST}" && cp -a "${SRC}/." "${DST}/" \
 && mkdir -p /out/dist && cp -a apps/api/dist/. /out/dist/

FROM os AS api
ENV NODE_ENV=production API_PORT=4000
# Only the compiled output and production dependencies (the deploy tree also holds sources and tool configs).
COPY --from=api-build --chown=node:node /out/package.json ./
COPY --from=api-build --chown=node:node /out/node_modules ./node_modules
COPY --from=api-build --chown=node:node /out/dist ./dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.API_PORT,path:'/api/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/main.js"]
