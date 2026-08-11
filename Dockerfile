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
# avoiding an apt-get step. It was also tried as a diagnostic for a
# better-sqlite3 native-addon segfault (see task-13-report.md) that turned
# out to occur on both -slim and -bookworm; kept here anyway since it
# removes the apt-get step and is otherwise equivalent.
FROM node:20-bookworm AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/src/shared/db/schema.sql ./src/shared/db/schema.sql

EXPOSE 3000
CMD ["node", "server.js"]
