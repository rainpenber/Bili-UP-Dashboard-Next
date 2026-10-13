# syntax=docker/dockerfile:1
# Unified production image: Bun API + prebuilt Vite SPA (single process).

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

FROM deps AS build-web
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
WORKDIR /app/apps/web
RUN bun run build

FROM deps AS runtime
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
COPY --from=build-web /app/apps/web/dist /app/web-dist
ENV API_PORT=3000
ENV WEB_STATIC_ROOT=/app/web-dist
EXPOSE 3000
WORKDIR /app
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=20s \
  CMD bun -e "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "run", "apps/api/src/index.ts"]
