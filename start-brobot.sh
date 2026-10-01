#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'BroBot needs Node.js 22.9 or newer. Install an LTS version from https://nodejs.org'
  exit 1
fi
exec node scripts/launch.js
