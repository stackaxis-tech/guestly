#!/usr/bin/env bash
# Build and ship Guestly to the VM. Usage: ./deploy/deploy.sh
# Secrets live in deploy/.env (never committed); data lives in Docker volumes on the VM.
set -euo pipefail
HOST="${GUESTLY_HOST:-ubuntu@ec2-43-204-102-193.ap-south-1.compute.amazonaws.com}"
KEY="${GUESTLY_KEY:-$HOME/Downloads/hack.pem}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ Building API (linux/amd64)"
(cd "$ROOT/backend" && go vet ./... && go test ./... >/dev/null \
  && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ../deploy/bin/guestly-api ./cmd/api \
  && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ../deploy/bin/createadmin ./cmd/createadmin)

echo "→ Building web"
(cd "$ROOT/frontend" && VITE_API_URL=/api/v1 npm run build >/dev/null && rm -rf ../deploy/web && cp -r dist ../deploy/web)

echo "→ Uploading"
rsync -az --delete --exclude ADMIN_CREDENTIALS.txt --exclude deploy.sh -e "ssh -i $KEY" "$ROOT/deploy/" "$HOST:~/guestly/"

echo "→ Restarting"
ssh -i "$KEY" "$HOST" 'cd ~/guestly && chmod 600 .env && docker compose up -d && docker compose restart api && sleep 3 && curl -fsS localhost/healthz && echo " healthy"'
