# Dockerfile
FROM node:20-slim AS base
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
# pdfjs-dist's worker script isn't traced into Next's standalone build
# output (see src/modules/documents/infrastructure/pdf-text-extractor.ts
# for why), so copy it to a fixed, version-independent location here —
# this stage still has the full node_modules install and a real shell, so
# the pdfjs-dist@* glob resolves normally — for the runner stage to pick
# up explicitly, without hardcoding the exact installed version anywhere.
RUN mkdir -p /app/vendor/pdf-worker && \
    cp node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs /app/vendor/pdf-worker/pdf.worker.mjs

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
COPY --from=deps /app/vendor/pdf-worker ./vendor/pdf-worker

EXPOSE 3000
CMD ["node", "server.js"]
