// The only files permitted in a public source release. Review additions explicitly.
export const sourceFiles = [
  '.gitignore', '.nvmrc', '.github/workflows/check.yml', 'LICENSE', 'README.md',
  'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.server.json', 'vite.config.ts',
  'docs/THIRD_PARTY_NOTICES.md', 'docs/SLAMTEC-SDK-LICENSE.txt',
  'src/shared.ts', 'src/demo.ts', 'src/proximity.ts', 'src/proximity.test.ts',
  'src/client/index.html', 'src/client/main.ts', 'src/client/style.css',
  'src/server/index.ts', 'src/server/rplidar.ts', 'src/server/lidar-tracker.ts',
  'src/server/lidar-tracker.test.ts', 'src/server/server.test.ts',
  'scripts/setup-lidar.sh', 'scripts/rplidar_bridge.cpp',
  'scripts/check-privacy.mjs', 'scripts/release.mjs', 'scripts/source-files.mjs'
];
