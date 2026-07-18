#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICE_DIR="${DOCUMENT_CONVERTER_DIR:-/opt/document-converter}"

if [ "$(id -u)" != "0" ]; then
  echo "请使用 root 运行。" >&2
  exit 1
fi

if [ -d "$SERVICE_DIR" ]; then
  cp -a "$SERVICE_DIR" "${SERVICE_DIR}.backup.$(date +%Y%m%d-%H%M%S)"
fi
mkdir -p "$SERVICE_DIR"
cp -a "$ROOT/document-converter/." "$SERVICE_DIR/"

cd "$SERVICE_DIR"
docker compose build document-converter
docker compose up -d document-converter

python3 "$ROOT/scripts/document-converter/install-nginx-location.py"
systemctl reload nginx
curl -fsS http://127.0.0.1:8810/health
echo
