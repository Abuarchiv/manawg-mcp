# syntax=docker/dockerfile:1

FROM node:22.12-alpine AS build
WORKDIR /app
RUN npm install -g corepack@latest --no-audit --no-fund && corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:22.12-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    MANAWG_TRANSPORT=http \
    MANAWG_HTTP_HOST=0.0.0.0 \
    MANAWG_HTTP_PORT=8080 \
    MANAWG_SESSION_CACHE=/data/session.json

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

RUN addgroup -S manawg && adduser -S -G manawg manawg \
    && mkdir -p /data \
    && chown -R manawg:manawg /data /app
USER manawg

EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${MANAWG_HTTP_PORT:-8080}/health" || exit 1
CMD ["node", "dist/index.js"]
