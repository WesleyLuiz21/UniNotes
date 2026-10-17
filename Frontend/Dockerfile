# syntax=docker/dockerfile:1
# UniNotes frontend: build the SPA with Node, serve static files with an unprivileged Caddy.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM caddy:2.10-alpine AS runtime
COPY --chown=root:root Caddyfile /etc/caddy/Caddyfile
COPY --from=build --chown=root:root /app/dist /srv
# Port 8080 needs no privileges: drop the binary's file capability so it runs with cap_drop: ALL.
RUN apk add --no-cache libcap \
 && setcap -r /usr/bin/caddy \
 && apk del libcap \
 && caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# Caddy's state dirs live on tmpfs at runtime (read-only root filesystem).
ENV XDG_CONFIG_HOME=/tmp/config XDG_DATA_HOME=/tmp/data
USER 65534:65534
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
