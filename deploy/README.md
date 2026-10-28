# Host Caddy: add and remove the UniNotes site

`Caddyfile.university` holds only the UniNotes site block. It is appended to the host Caddy's
`/etc/caddy/Caddyfile` **by hand** (it needs `sudo`). No script in this repository edits `/etc/caddy`.
The existing `notes.wesleyldshub.dev` block must stay byte-for-byte identical.

**Prerequisites:**
- The `university` A record resolves to the droplet (`dig +short university.wesleyldshub.dev` prints `178.62.99.141`). Without it, Caddy keeps failing certificate challenges.
- The UniNotes containers are healthy on loopback (`./scripts/healthcheck.sh --local`).

## Apply

```bash
cd /srv/UniNotes/app
STAMP=$(date +%F_%H%M%S)
mkdir -p /srv/UniNotes/backups/caddy
sudo cp /etc/caddy/Caddyfile /srv/UniNotes/backups/caddy/Caddyfile.$STAMP     # 1. backup
grep -q '^university\.wesleyldshub\.dev' /etc/caddy/Caddyfile && echo "ALREADY PRESENT: stop" \
  || { printf '\n' | sudo tee -a /etc/caddy/Caddyfile >/dev/null
       sudo tee -a /etc/caddy/Caddyfile < deploy/Caddyfile.university >/dev/null; }  # 2. append once
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile           # 3. must say "Valid configuration"
sudo systemctl reload caddy                                                     # 4. graceful; never "restart"
```

## Verify

```bash
curl -sI https://notes.wesleyldshub.dev | head -1            # Notes: must be unchanged (200)
curl -s  https://university.wesleyldshub.dev/api/health      # {"data":{"status":"ok","database":"ok"}}
curl -sI https://university.wesleyldshub.dev | head -1       # 200
# The Notes block is unchanged: the diff may only show added lines (prefixed with ">")
diff /srv/UniNotes/backups/caddy/Caddyfile.$STAMP /etc/caddy/Caddyfile
```

The first HTTPS request can take a few seconds while Caddy obtains the Let's Encrypt certificate.

## Roll back the Caddy change

```bash
sudo cp /srv/UniNotes/backups/caddy/Caddyfile.<STAMP> /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
curl -sI https://notes.wesleyldshub.dev | head -1
```

If `reload` fails, Caddy keeps serving the previous configuration: fix the file, or restore the
backup, and reload again.

## Keep in sync

- **Upload size:** `request_body max_size 30MB` is the attachment limit (`MAX_ATTACHMENT_MB=25` in `.env`) plus multipart overhead. Change both together.
- **Ports:** `127.0.0.1:3002` and `127.0.0.1:3003` must match `UNINOTES_BACKEND_HOST_PORT` and `UNINOTES_FRONTEND_HOST_PORT` in `.env`.
