#!/usr/bin/env bash
# Ships the committed code to the demo server and rebuilds only what changed. The database volume is untouched.
#   deploy/update.sh            # frontend + API
#   deploy/update.sh web        # frontend only (~1 min)
#   deploy/update.sh api        # API only
set -euo pipefail
HOST="${MUISTI_HOST:-ubuntu@16.170.90.24}"; KEY="${MUISTI_KEY:-$HOME/.ssh/muisti-key.pem}"
r() { ssh -i "$KEY" "$HOST" "$@"; }
cd "$(git rev-parse --show-toplevel)"
if [ -n "$(git status --porcelain)" ]; then echo "Uncommitted changes: commit first (the server gets the last commit)."; exit 1; fi
echo "Shipping $(git log --oneline -1)"
git archive --format=tar HEAD backend pipeline frontend deploy/Caddyfile deploy/Dockerfile.api deploy/Dockerfile.web \
  deploy/docker-compose.prod.yml deploy/mariadb-prod.cnf | r "tar -C ~/muisti -xf -"
r "cd ~/muisti/deploy && docker compose -f docker-compose.prod.yml --env-file .env up -d --build ${*:-web api} && docker image prune -f >/dev/null"
echo "Done: https://$(echo "${HOST#*@}" | tr . -).sslip.io"
