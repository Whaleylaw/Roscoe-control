#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
echo "Building mc-hello-world-agent:latest from $HERE"
docker build -t mc-hello-world-agent:latest .
echo "Done. Try: docker run --rm -it mc-hello-world-agent:latest --help  (agent has no flags; will attempt env-driven run)"
