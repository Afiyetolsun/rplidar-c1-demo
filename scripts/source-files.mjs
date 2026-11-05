// The only files permitted in a public source release. Review additions explicitly.
export const sourceFiles = [
  '.gitignore', '.nvmrc', '.github/workflows/check.yml', 'LICENSE', 'README.md',
  'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.server.json', 'vite.config.ts',
  'docs/THIRD_PARTY_NOTICES.md', 'docs/SLAMTEC-SDK-LICENSE.txt', 'docs/demo-interface.jpg', 'docs/firefly-display.jpg', 'docs/waveshare-display.jpg',
  'src/shared.ts', 'src/demo.ts', 'src/proximity.ts', 'src/proximity.test.ts',
  'src/server/registration.ts', 'src/server/registration.test.ts',
  'src/server/room-alignment.ts', 'src/server/room-alignment.test.ts', 'scripts/align-room.ts',
  'src/client/room.ts',
  'src/client/index.html', 'src/client/main.ts', 'src/client/style.css',
  'src/server/firefly.ts', 'src/server/firefly.test.ts',
  'firmware/firefly/main/radar-ui.c', 'firmware/firefly/main/radar-ui.h',
  'firmware/firefly/tests/radar-ui-test.c', 'scripts/test-firefly.sh',
  'firmware/firefly/dependencies.lock',
  'firmware/firefly/CMakeLists.txt', 'firmware/firefly/sdkconfig.defaults', 'firmware/firefly/sdkconfig.defaults.waveshare',
  'firmware/firefly/main/CMakeLists.txt', 'firmware/firefly/main/main.c',
  'firmware/firefly/main/waveshare_panel.c', 'firmware/firefly/main/waveshare_panel.h',
  'firmware/firefly/README.md', 'scripts/build-firefly.sh', 'scripts/build-waveshare.sh',
  'scripts/flash-firefly.sh', 'scripts/flash-waveshare.sh', 'scripts/provision-firefly.py',
  'src/server/index.ts', 'src/server/rplidar.ts', 'src/server/lidar-tracker.ts',
  'src/server/lidar-tracker.test.ts', 'src/server/server.test.ts',
  'scripts/setup-lidar.sh', 'scripts/rplidar_bridge.cpp',
  'scripts/check-privacy.mjs', 'scripts/release.mjs', 'scripts/source-files.mjs'
];

// Binary files approved for the public source release. Review a replacement before changing its fingerprint.
export const reviewedImages = {
  'docs/demo-interface.jpg': '12d8a9f607eec93074b37308bb55258b4ddb5f856f3ee6726fdc17555125ccb7',
  'docs/firefly-display.jpg': '9c69342c0e7991763998a6360db4f2f0ec1a6be46f9caac78c130602885a22b9',
  'docs/waveshare-display.jpg': '5def27734b58d47e5a987d9687fa8916c81233c4e1014eb13756c5840ee67ae1'
};
