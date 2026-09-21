#!/usr/bin/env bash
# Publishes the netstandard2.0 IForevents.dll and its NuGet dependencies into Runtime/Plugins
# from the sibling .NET repository (../iforevents-dotnet). Needs docker (uses the dotnet sdk image).
set -euo pipefail
cd "$(dirname "$0")/.."
DOTNET=../iforevents-dotnet
mkdir -p Runtime/Plugins
(cd "$DOTNET" && ./docker-run.sh publish src/IForevents/IForevents.csproj -c Release -f netstandard2.0 -o /app/artifacts/unity-plugins)
cp "$DOTNET"/artifacts/unity-plugins/*.dll Runtime/Plugins/
rm -f Runtime/Plugins/netstandard.dll
ls -1 Runtime/Plugins
