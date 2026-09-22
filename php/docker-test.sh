#!/usr/bin/env bash
# Runs composer install + phpunit for every package inside php:8.3-cli (no local PHP needed).
set -euo pipefail
cd "$(dirname "$0")"
for pkg in iforevents iforevents-mixpanel iforevents-segment; do
  [ -d "$pkg" ] || continue
  echo "== $pkg"
  docker run --rm -v "$PWD:/app" -w "/app/$pkg" -e COMPOSER_CACHE_DIR=/app/.composer-cache composer:2 install --no-interaction --quiet
  docker run --rm -v "$PWD:/app" -w "/app/$pkg" php:8.3-cli vendor/bin/phpunit --colors=never "$@"
done
