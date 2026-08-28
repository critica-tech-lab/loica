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

`.github/workflows/publish-image.yml` publishes the base image to
`ghcr.io/critica-tech-lab/loica` on every push to `main` and on version tags,
which is what `FROM_IMAGE` defaults to. So the normal build is one step:

```bash
cloudron build          # from this directory
```

> **First publish only:** a new ghcr package is private even when the repository
> is public. Until someone flips it to public under the repository's *Packages*
> settings, `cloudron install` cannot pull it and the build above cannot resolve
> `FROM_IMAGE`.

To build against local changes instead of the published image — which is what
you want while developing the package itself:

```bash
# 1. Loica's ordinary image, from the repository root
docker build -t loica:local .

# 2. The Cloudron layer on top of it
docker build -t loica-cloudron --build-arg FROM_IMAGE=loica:local cloudron/
```

Then push `loica-cloudron` to a registry your Cloudron can reach:

```bash
cloudron install --image <registry>/loica-cloudron:<tag>
```

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

`logo.png` is the square 256×256 variant of the Loica mark, supplied as
artwork. Replace it with another square PNG if the brand changes — do not derive
one from `public/loica-logo.png`, which is the wide lockup.
