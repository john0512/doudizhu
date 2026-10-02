#!/bin/sh
set -e
cd "$(dirname "$0")"
if command -v node >/dev/null 2>&1; then
  NODE=node
else
  NODE="/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node"
fi
exec "$NODE" server/index.mjs
