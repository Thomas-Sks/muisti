#!/usr/bin/env bash
# Streams the local MariaDB data volume to the server over SSH (no local archive: the laptop disk is nearly full).
# Physical copy of a stopped server, same MariaDB version (12.3): vector (HNSW) and full-text indexes come as they are.
#   deploy/copy-db.sh ubuntu@<server-ip> [path/to/key.pem]
set -euo pipefail
HOST="$1"; KEY="${2:-}"
SSH=(ssh -o StrictHostKeyChecking=accept-new ${KEY:+-i "$KEY"} "$HOST")
VOL=wikipedia_muisti-data
REMOTE_VOL=deploy_muisti-data          # name given by docker compose for project "deploy"
echo "Stopping local MariaDB for a consistent copy…"
docker stop muisti-mariadb
trap 'docker start muisti-mariadb >/dev/null' EXIT
# start from an empty volume on the server (a stream cannot resume an interrupted copy)
"${SSH[@]}" "docker volume create $REMOTE_VOL >/dev/null && docker run --rm --log-driver none -v $REMOTE_VOL:/v alpine sh -c 'rm -rf /v/..?* /v/.[!.]* /v/*'"
# --log-driver none: otherwise Docker also writes the whole stream into the container's log on the local disk
docker run --rm --log-driver none -v "$VOL":/v:ro alpine tar -C /v -cf - . \
  | gzip -1 \
  | "${SSH[@]}" "docker run --rm -i --log-driver none -v $REMOTE_VOL:/v alpine sh -c 'gunzip | tar -C /v -xf -'"
echo "Copied. Local MariaDB restarts now."
