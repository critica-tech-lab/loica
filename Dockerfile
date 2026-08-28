# syntax=docker/dockerfile:1
#
# Loica runs as two processes — the web server and the Yjs WebSocket server —
# that share one SQLite database and one uploads directory. This image holds
# both; which one starts is the container's command. See docker-compose.yml.
#
#   web (default)  node node_modules/.bin/react-router-serve ./build/server/index.js
#   ws             node ws-server.ts
#
# Mutable state lives entirely under DATA_DIR (/data), so the image itself is
# disposable and can run with a read-only root filesystem.

# ── Toolchain ────────────────────────────────────────────────────────────────
# Shared by the two install stages. Built on the runtime's own base so the
# native modules (better-sqlite3, @node-rs/argon2, sharp) are compiled and
# linked against the exact glibc and node ABI they will run on.
FROM node:24-bookworm-slim AS toolchain

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip python3 build-essential \
    && rm -rf /var/lib/apt/lists/*

# The repo locks dependencies with bun.lock, so installing needs bun. Only the
# build stages do — the runtime is plain node.
ENV BUN_INSTALL=/usr/local
RUN curl -fsSL https://bun.sh/install | bash

WORKDIR /app/code

# ── Build ────────────────────────────────────────────────────────────────────
FROM toolchain AS build

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# The build context has no .git, so the commit shown in the admin panel comes
# from here: docker build --build-arg SOURCE_COMMIT=$(git rev-parse HEAD)
ARG SOURCE_COMMIT=""
ENV SOURCE_COMMIT=${SOURCE_COMMIT}

RUN bun run build

# ── Runtime dependencies ─────────────────────────────────────────────────────
# A separate install rather than a prune, because bun does not remove packages
# from an existing node_modules.
FROM toolchain AS prod-deps

COPY package.json bun.lock ./

# --omit=peer as a standing guard. Peers are a build-time concern that nothing
# here loads at runtime, and one of them — next, pulled in by the `geist` font
# package — used to cost this image ~370 MB on its own. That dependency is gone
# now, but the flag keeps the next one from arriving unnoticed.
RUN bun install --frozen-lockfile --production --omit=peer

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim

# tini reaps zombies and forwards SIGTERM, which the WS server needs: on that
# signal it flushes every open Yjs document to SQLite before exiting. Without
# it, `docker stop` costs unsaved edits.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/code

COPY --from=prod-deps /app/code/node_modules ./node_modules
COPY --from=build     /app/code/build        ./build

# The WS server runs from TypeScript source and imports app/lib/*, and the PDF
# and DOCX exporters read assets/fonts at runtime.
COPY --from=build /app/code/app          ./app
COPY --from=build /app/code/ws           ./ws
COPY --from=build /app/code/ws-server.ts ./ws-server.ts
COPY --from=build /app/code/assets       ./assets
COPY --from=build /app/code/package.json ./package.json

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    HOST=0.0.0.0 \
    WS_PORT=4001 \
    WS_HOST=0.0.0.0

# Database, uploads and drop-in plugins. Mount a volume here.
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data

EXPOSE 3000 4001
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "node_modules/.bin/react-router-serve", "./build/server/index.js"]
