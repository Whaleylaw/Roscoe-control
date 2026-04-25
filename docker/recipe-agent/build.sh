#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
echo "Building mc-recipe-agent:latest from $HERE"
docker build -t mc-recipe-agent:latest .
echo "Done. Recipe YAML can now use: image: mc-recipe-agent:latest"
