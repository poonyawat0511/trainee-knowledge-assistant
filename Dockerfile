# Dockerfile
FROM node:20-slim AS base
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# node:20-bookworm (full, non-slim) is used for the runner stage rather than
# node:20-slim: it already ships wget (needed by the compose healthcheck),
# avoiding an apt-get step.
FROM node:20-bookworm AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/src/shared/db/schema.sql ./src/shared/db/schema.sql
# sql.js's WASM binary isn't picked up by Next's standalone file tracer
# (see src/shared/db/client.ts) — copy it explicitly from the full
# node_modules install (the build stage's, not the pruned standalone one).
COPY --from=deps /app/node_modules/sql.js/dist/sql-wasm.wasm ./node_modules/sql.js/dist/sql-wasm.wasm

EXPOSE 3000
CMD ["node", "server.js"]
