#!/bin/sh
# Runs an npm script inside the dev container with the repo mounted at /app.
# node_modules live in Docker volumes; they are reinstalled only when package-lock.json changes.
set -e
cd /app
hash=$(sha1sum package-lock.json | cut -d' ' -f1)
if [ "$(cat node_modules/.lockhash 2>/dev/null)" != "$hash" ]; then
  echo "Installing dependencies (package-lock.json changed)…"
  npm ci --no-audit --no-fund
  npx remotion browser ensure
  echo "$hash" > node_modules/.lockhash
fi
exec npm run "$@"
