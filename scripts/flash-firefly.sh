#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "$#" -ne 1 ]; then echo "Usage: $0 /dev/cu.usbmodem..." >&2; exit 2; fi
# Explicit port prevents accidentally opening the LiDAR adapter.
.deps/esp-tools/bin/python -m esptool --chip esp32c3 --port "$1" \
  write-flash --flash-mode dio --flash-size 16MB --flash-freq 80m \
  0x0 .deps/firefly/build/bootloader/bootloader.bin \
  0x8000 .deps/firefly/build/partition_table/partition-table.bin \
  0x10000 .deps/firefly/build/firefly_heartbeat.bin
