import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** Only restore placements computed for these exact scan bytes. */
export function loadRoomAlignment(file: string | undefined) {
  if (!file) return undefined;
  try {
    const value = JSON.parse(readFileSync(file + '.alignment.json', 'utf8'));
    if (value.version !== 1 || value.roomSha256 !== createHash('sha256').update(readFileSync(file)).digest('hex')) return undefined;
    if (!['x', 'z', 'yaw', 'height', 'overlap', 'error'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))) return undefined;
    if (Math.abs(value.x) > 50 || Math.abs(value.z) > 50 || value.height < .15 || value.height > 2.5 || value.overlap < .65 || value.overlap > 1 || value.error < 0 || value.error > .14) return undefined;
    return { x: value.x as number, z: value.z as number, yaw: value.yaw as number, height: value.height as number, overlap: value.overlap as number, error: value.error as number };
  } catch { return undefined; }
}
