#!/bin/bash
# Builds the card and deploys dist/legend-table.js to the Home Assistant instance.
#
# Configuration comes from .env (see .env.example); environment variables that
# are already set take precedence.

set -e

cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

HOST="${HA_HOST:-}"
CONFIG="${HA_CONFIG:-/config}"
TARGET="${HA_TARGET:-${CONFIG}/www/community/ha-legend-table}"
SSH_PORT="${HA_SSH_PORT:-22}"

if [ -z "$HOST" ]; then
  echo "HA_HOST is not set. Copy .env.example to .env and fill it in." >&2
  exit 1
fi

echo "Building card ..."
npm ci --silent
# The local build counter is opt-in, so only the bundle deployed from here
# carries one; releases built on GitHub stay at the plain semver.
LEGENDTABLE_BUILD_COUNTER=1 npm run build

echo "Deploying legend-table.js to ${HOST}:${TARGET} ..."
ssh -p "${SSH_PORT}" "${HOST}" "mkdir -p ${TARGET}"
scp -P "${SSH_PORT}" dist/legend-table.js "${HOST}:${TARGET}/"

# Read back what the build baked into the bundle, so the message below names
# the exact build that was just deployed.
VERSION="$(node -p "require('./package.json').version")+build.$(cat .build-number 2>/dev/null || echo '?')"

echo "Done. Deployed version: ${VERSION}"
echo "Clear the browser cache and reload the dashboard."
echo "Resource URL: /hacsfiles/ha-legend-table/legend-table.js"
