#!/bin/bash
set -euo pipefail
directory="$RUNNER_TEMP/sdk-maven"
mkdir -p "$directory"
archive="$directory/apache-maven-3.8.7-bin.tar.gz"
curl -fL --retry 3 https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.8.7/apache-maven-3.8.7-bin.tar.gz -o "$archive"
printf '21c2be0a180a326353e8f6d12289f74bc7cd53080305f05358936f3a1b6dd4d91203f4cc799e81761cf5c53c5bbe9dcc13bdb27ec8f57ecf21b2f9ceec3c8d27  %s\n' "$archive" | shasum -a 512 --check
tar -xzf "$archive" -C "$directory"
printf '%s\n' "$directory/apache-maven-3.8.7/bin" >> "$GITHUB_PATH"
