# syntax=docker/dockerfile:1
# UniNotes frontend: build the SPA with Node, serve static files with an unprivileged Caddy.

FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Caddy rebuilt with patched Go/x-net (same pins as docker/caddy/Dockerfile).
FROM golang:1.26.9-alpine AS caddy
ENV CGO_ENABLED=0 GOFLAGS=-trimpath
RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7
RUN xcaddy build v2.11.7 --replace golang.org/x/net=golang.org/x/net@v0.60.0 --output /out/caddy

FROM caddy:2.11-alpine AS runtime
COPY --from=caddy /out/caddy /usr/bin/caddy
COPY --chown=root:root Caddyfile /etc/caddy/Caddyfile
COPY --from=build --chown=root:root /app/dist /srv
# The rebuilt binary carries no file capabilities, so it runs under cap_drop: ALL on port 8080.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# Caddy's state dirs live on tmpfs at runtime (read-only root filesystem).
ENV XDG_CONFIG_HOME=/tmp/config XDG_DATA_HOME=/tmp/data
USER 65534:65534
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
