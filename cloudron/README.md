# Loica's Cloudron package

The Loica-maintained [Cloudron](https://cloudron.io) package, versioned with the
app rather than in a separate repository.

Nothing in `app/` is Cloudron-specific. This directory is the whole adaptation:
a manifest, a thin image layer, and a start script that maps the platform's
addon environment onto the variables Loica already reads.

## What it does

Cloudron allows an app one HTTP port. Loica listens on two, so the container
runs an nginx that merges them:

```
             Cloudron nginx  (TLS, WebSocket upgrade)
                        │
                        ▼  httpPort 8000
        ┌───────────────────────────────────────────┐
        │  nginx :8000                              │
        │    /ws  → 127.0.0.1:4001                  │
        │    /    → 127.0.0.1:3000                  │
        │                                           │
        │  supervisord                              │
        │    ├─ nginx                               │
        │    ├─ react-router-serve   :3000  (web)   │
        │    └─ node ws-server.ts    :4001  (yjs)   │
        │                                           │
        │  /app/code   read-only                    │
        │  /app/data   persistent, backed up        │
        │  /run, /tmp  writable, ephemeral          │
        └───────────────────────────────────────────┘
```

Both node processes open the same SQLite database, which is how Loica already
runs under systemd and pm2.

## Addons

| Addon | Required | What it gives you |
|---|---|---|
| `localstorage` | yes | `/app/data` for the database, uploads and plugins, with consistent SQLite backups |
| `sendmail` | no | Invitations and password resets. Without it, mail is logged instead of sent |
| `oidc` | no | Single sign-on. Credentials are wired up automatically; an admin still enables the extension |

`optionalSso` is set, because Loica ships working email and password auth.

## Building

The base image is not published to a registry yet, so the build is two steps:

```bash
# 1. Loica's ordinary image, from the repository root
docker build -t loica:local .

# 2. The Cloudron layer on top of it
docker build -t loica-cloudron --build-arg FROM_IMAGE=loica:local cloudron/
```

Then push `loica-cloudron` to a registry your Cloudron can reach and install it:

```bash
cloudron install --image <registry>/loica-cloudron:<tag>
```

Once the base image is published, `cloudron build` from this directory works
directly — `FROM_IMAGE` already defaults to the intended registry path.

## Developing against a running install

```bash
cloudron logs -f
cloudron exec               # inspect the filesystem
cloudron debug              # writable filesystem, CMD not run
cloudron debug --disable
```

## Releasing

`version` in `CloudronManifest.json` is what Cloudron compares to decide
whether an update is available. Bump it with the app.

Before publishing, fill in the empty fields in the manifest — `packagerName`,
`packagerUrl`, `contactEmail`, `iconUrl` — and add a square `logo.png`.
