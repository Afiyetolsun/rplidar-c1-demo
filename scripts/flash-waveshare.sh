#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "$#" -ne 1 ]; then echo "Usage: $0 /dev/cu.usbmodem..." >&2; exit 2; fi
identity=$(.deps/esp-tools/bin/python -m esptool --port "$1" chip-id 2>&1 || true)
printf '%s\n' "$identity" | grep -q "ESP32-S3" || {
  echo "Refusing to flash $1: this image is only for the Waveshare ESP32-S3." >&2
  exit 1
}
.deps/esp-tools/bin/python -m esptool --chip esp32s3 --port "$1" \
  write-flash --flash-mode dio --flash-size 16MB --flash-freq 80m \
  0x0 .deps/waveshare/build/bootloader/bootloader.bin \
  0x8000 .deps/waveshare/build/partition_table/partition-table.bin \
  0x10000 .deps/waveshare/build/firefly_heartbeat.bin
