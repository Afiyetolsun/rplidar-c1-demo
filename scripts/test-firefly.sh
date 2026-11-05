#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .deps/firefly-ui
cc -std=c11 -Wall -Wextra -Werror -Ifirmware/firefly/main \
  firmware/firefly/main/radar-ui.c firmware/firefly/tests/radar-ui-test.c \
  -lm -o .deps/firefly-ui/test
.deps/firefly-ui/test .deps/firefly-ui
