#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .deps/firefly
if [ ! -d .deps/firefly/firefly-display/.git ]; then
  git clone https://github.com/firefly/component-display.git .deps/firefly/firefly-display
fi
git -C .deps/firefly/firefly-display checkout --detach 0f9183f9ebe2d462edf650e1afa70144aa7b87a5
# Keep all SDK output and local configuration outside release sources.
cp firmware/firefly/sdkconfig.defaults .deps/firefly/sdkconfig.defaults
docker run --rm -v "$PWD:/project" -w /project/firmware/firefly \
  -e HOME=/tmp -e FIREFLY_DISPLAY_DIR=/project/.deps/firefly/firefly-display \
  espressif/idf:v5.5.1 idf.py -B /project/.deps/firefly/build \
  -D SDKCONFIG=/project/.deps/firefly/sdkconfig build
