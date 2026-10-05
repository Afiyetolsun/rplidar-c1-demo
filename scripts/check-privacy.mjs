import { readdir, readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourceFiles } from './source-files.mjs';

export async function checkPrivacy() {
  const allowed = new Set(sourceFiles);
  const ignored = new Set(['.git', 'node_modules', '.deps', 'dist', 'release', 'coverage', '.DS_Store']);
  const failures = [];
  async function walk(dir = '') {
    for (const entry of await readdir(dir || '.', { withFileTypes: true })) {
      if (!dir && ignored.has(entry.name)) continue;
      const file = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) failures.push(`${file}: symlinks are not allowed in release sources`);
      else if (entry.isDirectory()) await walk(file);
      else if (!allowed.has(file)) failures.push(`${file}: unexpected file; review it before adding to the release allowlist`);
    }
  }
  await walk();
  for (const file of sourceFiles) {
    try {
      if (!(await lstat(file)).isFile()) { failures.push(`${file}: not a regular file`); continue; }
      const bytes = await readFile(file);
      if (bytes.includes(0)) failures.push(`${file}: binary content`);
      // Check contents without printing potentially sensitive matched values.
      const content = bytes.toString('utf8');
      const markers = [
        /\/(?:Users|home)\/[a-zA-Z0-9_.-]+\//,
        /room-pointcloud\.ply|room-3dgs\.spz/,
        /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
        /\b(?:ghp_|github_pat_|sk-proj-)[a-zA-Z0-9_]{16,}/,
        /(?:serialNumber|serialnum)\s*[=:]\s*['"][0-9a-fA-F]{8,}/
      ];
      if (markers.some(marker => marker.test(content))) failures.push(`${file}: possible private-data marker`);
    } catch { failures.push(`${file}: missing or unreadable`); }
  }
  if (failures.length) throw new Error(`Source privacy check failed:\n${failures.map(f => `- ${f}`).join('\n')}`);
  return sourceFiles;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const files = await checkPrivacy(); console.log(`Privacy check passed: ${files.length} explicit source files; no real scan assets included.`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
