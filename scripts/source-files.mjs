// The only files permitted in a public source release. Review additions explicitly.
export const sourceFiles = [
  '.gitignore', '.nvmrc', '.github/workflows/check.yml', 'LICENSE', 'README.md',
  'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.server.json', 'vite.config.ts',
  'docs/THIRD_PARTY_NOTICES.md', 'docs/SLAMTEC-SDK-LICENSE.txt', 'docs/demo-interface.jpg',
  'src/shared.ts', 'src/demo.ts', 'src/proximity.ts', 'src/proximity.test.ts',
  'src/client/index.html', 'src/client/main.ts', 'src/client/style.css',
  'src/server/index.ts', 'src/server/rplidar.ts', 'src/server/lidar-tracker.ts',
  'src/server/lidar-tracker.test.ts', 'src/server/server.test.ts',
  'scripts/setup-lidar.sh', 'scripts/rplidar_bridge.cpp',
  'scripts/check-privacy.mjs', 'scripts/release.mjs', 'scripts/source-files.mjs'
];

// Only this visually reviewed synthetic screenshot is approved as binary content.
// Review a replacement image before updating its fingerprint.
export const reviewedImages = {
  'docs/demo-interface.jpg': '12d8a9f607eec93074b37308bb55258b4ddb5f856f3ee6726fdc17555125ccb7'
};
