# Cloudron layer on top of Loica's ordinary image.
#
# The base image already carries the build, the runtime dependencies, and both
# processes; see the Dockerfile at the repository root. This layer only adds
# what the platform requires:
#
#   - one HTTP port, so an in-container nginx merges the web and WebSocket
#     servers behind it
#   - supervisor, because the container now runs three processes
#   - gosu, because Cloudron starts start.sh as root and the app must not stay
#     there
#
# Built in two steps, since the base image is not published to a registry yet:
#
#   docker build -t loica:local .                       # from the repo root
#   docker build -t loica-cloudron \
#     --build-arg FROM_IMAGE=loica:local cloudron/
#
# See cloudron/README.md.
ARG FROM_IMAGE=ghcr.io/critica-tech-lab/loica:latest
FROM ${FROM_IMAGE}

USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
      nginx supervisor gosu \
    && rm -rf /var/lib/apt/lists/*

# Ours replaces the stock config outright — see the header in nginx.conf for
# why a vhost beside it is not enough on a read-only filesystem.
COPY nginx.conf       /etc/nginx/nginx.conf
COPY supervisord.conf /etc/supervisor/supervisord.conf
COPY start.sh         /app/code/start.sh
RUN chmod +x /app/code/start.sh

# Cloudron mounts persistent data at /app/data, not the base image's /data.
ENV DATA_DIR=/app/data

# The platform runs the healthcheck itself against healthCheckPath.
HEALTHCHECK NONE

EXPOSE 8000

CMD [ "/app/code/start.sh" ]
