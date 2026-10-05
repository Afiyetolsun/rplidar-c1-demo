import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkPrivacy } from './check-privacy.mjs';

const files = await checkPrivacy();
const staging = await mkdtemp(join(tmpdir(), 'c1-demo-release-'));
try {
  const folder = join(staging, 'rplidar-c1-demo');
  for (const file of files) { const target = join(folder, file); await mkdir(dirname(target), { recursive: true }); await copyFile(file, target); }
  await mkdir('release', { recursive: true });
  const output = resolve('release/rplidar-c1-demo-source.tar.gz');
  execFileSync('tar', ['-czf', output, '-C', staging, 'rplidar-c1-demo'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  console.log(`Source release ready: ${output} (${files.length} files; no Git history or runtime data)`);
} finally { await rm(staging, { recursive: true, force: true }); }
