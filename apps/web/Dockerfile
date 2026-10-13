# syntax=docker/dockerfile:1

FROM oven/bun:1.3.10 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/monitoring/package.json packages/monitoring/
COPY packages/workflow/package.json packages/workflow/
RUN bun install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
WORKDIR /app/apps/web
RUN bun run build

FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
