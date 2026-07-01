#!/bin/sh
set -e

# Docker volumes use ./config/config.jsonc — link to the path configReader expects.
if [ -f /app/config/config.jsonc ]; then
  ln -sfn /app/config/config.jsonc /app/config.jsonc
fi

# Link trade-config files into trade/settings so runtime saves (WebUI, commands) persist
# on the mounted volume and fs.watch sees the same path the bot reads/writes.
if [ -d /app/trade-config ]; then
  for file in /app/trade-config/tradeParams_*.js; do
    [ -e "$file" ] || continue
    ln -sfn "$file" "/app/trade/settings/$(basename "$file")"
  done
fi

if [ "$1" = "mm" ]; then
  shift
  set -- node /app/bin/mm.js "$@"
fi

exec "$@"
