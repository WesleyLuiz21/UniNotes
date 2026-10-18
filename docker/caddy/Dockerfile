# syntax=docker/dockerfile:1
# Edge proxy image: official Caddy v2.11.7 source, rebuilt with a patched Go toolchain and
# golang.org/x/net so known HTTP/2, Range-header and TLS-ECH denial-of-service CVEs present in the
# official binary (Go 1.26.8, x/net 0.59.0) are fixed. Bump these pins when upstream catches up.
ARG CADDY_VERSION=v2.11.7

FROM golang:1.26.9-alpine AS build
ARG CADDY_VERSION
ENV CGO_ENABLED=0 GOFLAGS=-trimpath
RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7
RUN xcaddy build ${CADDY_VERSION} --replace golang.org/x/net=golang.org/x/net@v0.60.0 --output /out/caddy

FROM caddy:2.11-alpine
COPY --from=build /out/caddy /usr/bin/caddy
# Run unprivileged. Ports 80/443 are bound via the namespaced sysctl
# net.ipv4.ip_unprivileged_port_start=0 (compose.yaml), so no capabilities are needed at all.
# Named volumes mounted on /data and /config inherit this ownership on first use.
RUN mkdir -p /data/caddy /config/caddy \
 && chown -R 1001:1001 /data /config \
 && caddy version
USER 1001:1001
