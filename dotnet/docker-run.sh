#!/usr/bin/env bash
# Runs a dotnet command inside mcr.microsoft.com/dotnet/sdk:8.0 (no local .NET needed).
# Usage: ./docker-run.sh test   |   ./docker-run.sh run --project tools/Smoke
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .nuget-cache
docker run --rm -v "$PWD:/app" -w /app -e NUGET_PACKAGES=/app/.nuget-cache -e DOTNET_CLI_TELEMETRY_OPTOUT=1 -e DOTNET_NOLOGO=1 -e IFOREVENTS_PROJECT_KEY="${IFOREVENTS_PROJECT_KEY:-}" -e IFOREVENTS_BASE_URL="${IFOREVENTS_BASE_URL:-}" mcr.microsoft.com/dotnet/sdk:8.0 dotnet "$@"
