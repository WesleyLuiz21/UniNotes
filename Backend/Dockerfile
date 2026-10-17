# syntax=docker/dockerfile:1
# UniNotes backend: Express + SQLite (embedded). Multi-stage, non-root, read-only-rootfs friendly.

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/dist ./dist
COPY --chown=root:root drizzle ./drizzle
COPY --chown=root:root package.json ./
# Data directories are owned by the unprivileged runtime user; named volumes inherit this ownership.
RUN mkdir -p /data/db /data/attachments /data/backups \
 && chown -R node:node /data \
 && chmod 700 /data/db /data/attachments /data/backups
USER node
VOLUME ["/data/db", "/data/attachments", "/data/backups"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "dist/scripts/healthcheck.js"]
CMD ["node", "dist/src/server.js"]
