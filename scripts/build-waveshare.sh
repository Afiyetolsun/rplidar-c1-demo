#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .deps/waveshare
docker run --rm -v "$PWD:/project" -w /project/firmware/firefly \
  -e HOME=/tmp -e FIREFLY_BOARD=waveshare \
  espressif/idf:v5.5.1 idf.py -B /project/.deps/waveshare/build \
  -D SDKCONFIG=/project/.deps/waveshare/sdkconfig \
  -D SDKCONFIG_DEFAULTS=/project/firmware/firefly/sdkconfig.defaults.waveshare build
