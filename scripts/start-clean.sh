#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

for port in 5173 5174 5175 5176 5177 8787; do
  for pid in $(lsof -ti tcp:"$port" 2>/dev/null || true); do
    kill -9 "$pid" || true
  done
done

pkill -f 'vite --host 0.0.0.0' || true
pkill -f 'tsx watch server/index.ts' || true
pkill -f 'tsx server/index.ts' || true

nohup npx tsx server/index.ts > /tmp/ingallery-api.log 2>&1 &
nohup npx vite --host 0.0.0.0 --port 5173 --strictPort > /tmp/ingallery-vite.log 2>&1 &

sleep 8

echo '--- API ---'
cat /tmp/ingallery-api.log | tail -n 20

echo '--- VITE ---'
cat /tmp/ingallery-vite.log | tail -n 20

echo '--- HEALTH ---'
curl -sS http://localhost:8787/health

echo

echo '--- PAGE ---'
curl -sS http://localhost:5173/ | head -c 160

echo
