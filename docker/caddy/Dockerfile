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
# Allow binding :80/:443 as the default user with only NET_BIND_SERVICE (see compose.yaml).
RUN apk add --no-cache libcap && setcap cap_net_bind_service=+ep /usr/bin/caddy && apk del libcap && caddy version
