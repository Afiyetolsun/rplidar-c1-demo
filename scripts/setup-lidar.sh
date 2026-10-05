#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
sdk_dir="${RPLIDAR_SDK_DIR:-$PWD/.deps/rplidar-sdk}"
sdk_revision=99478e5fb90de3b4a6db0080acacd373f8b36869
if [[ ! -d "$sdk_dir/sdk" ]]; then
  mkdir -p "$(dirname "$sdk_dir")"
  git clone https://github.com/Slamtec/rplidar_sdk.git "$sdk_dir"
  git -C "$sdk_dir" checkout --detach "$sdk_revision"
fi
make -C "$sdk_dir/sdk" -j4
mkdir -p .deps/lidar
"${CXX:-c++}" -std=c++17 -O2 -pthread -I"$sdk_dir/sdk/include" scripts/rplidar_bridge.cpp \
  "$sdk_dir/output/$(uname -s)/Release/libsl_lidar_sdk.a" -o .deps/lidar/rplidar-bridge
cp "$sdk_dir/LICENSE" .deps/lidar/SLAMTEC-SDK-LICENSE.txt
echo 'RPLIDAR C1 bridge ready. Open the dashboard, choose Live C1, select a USB port and connect.'
