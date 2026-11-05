import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { WebSocket } from 'ws';
import { registerLidar, stableLidarSlice, type PlanarPoint } from '../src/server/registration.js';
import type { LidarFrame } from '../src/shared.js';

const file = process.argv[2];
if (!file) throw new Error('Usage: npx tsx scripts/align-room.ts path/to/room.ply [height-metres]');
const specifiedHeight = process.argv[3] === undefined ? undefined : Number(process.argv[3]);
if (specifiedHeight !== undefined && (!Number.isFinite(specifiedHeight) || specifiedHeight < .15 || specifiedHeight > 2.5)) throw new Error('Height must be 0.15–2.5 metres.');
const bytes = readFileSync(file);
const geometry = new PLYLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
geometry.computeBoundingBox();
const box = geometry.boundingBox!;
const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2, floor = box.min.y;
const position = geometry.getAttribute('position');
console.log('Collecting 50 live revolutions in memory; keep the sensor stationary and reveal the walls.');
const frames = await new Promise<LidarFrame['points'][]>((resolve, reject) => {
  const ws = new WebSocket(process.env.C1_ALIGNMENT_WS ?? 'ws://127.0.0.1:8788/ws');
  const collected: LidarFrame['points'][] = [];
  const timeout = setTimeout(() => { ws.close(); reject(new Error('No fresh live C1 scan within 15 seconds.')); }, 15000);
  ws.on('error', error => { clearTimeout(timeout); reject(error); });
  ws.on('message', data => {
    const f = JSON.parse(String(data));
    if (f.kind !== 'lidar' || Math.abs(Date.now() - f.timestamp) > 1800) return;
    collected.push(f.points);
    if (collected.length === 50) { clearTimeout(timeout); ws.close(); resolve(collected); }
  });
});
const scan = stableLidarSlice(frames);
const heights = specifiedHeight !== undefined ? [specifiedHeight] : Array.from({ length: 17 }, (_, i) => .3 + i * .1);
const results = [];
for (const height of heights) {
  const cells = new Map<string, PlanarPoint>();
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(position.getY(i) - floor - height) > .1) continue;
    const x = position.getX(i) - cx, z = position.getZ(i) - cz;
    cells.set(`${Math.round(x / .035)},${Math.round(z / .035)}`, [x, z]);
  }
  if (cells.size < 80) continue;
  const result = registerLidar([...cells.values()], scan);
  const best = result.candidates[0];
  results.push({ height, ...result, cost: best.error + (1 - best.overlap) * .12 + (1 - best.farOverlap) * .06 });
  console.log(JSON.stringify({ height: +height.toFixed(2), ...best, reliable: result.reliable, ambiguous: result.ambiguous }));
}
results.sort((a,b) => a.cost - b.cost);
const winner = results[0];
if (!winner?.reliable) throw new Error('No reliable unambiguous alignment. No saved placement changed. Check scan, height and visible walls.');
const pose = winner.candidates[0], c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
const alignment = {
  version: 1, roomSha256: createHash('sha256').update(bytes).digest('hex'),
  x: -c * pose.x + s * pose.z, z: -s * pose.x - c * pose.z, yaw: -pose.yaw * 180 / Math.PI, height: winner.height,
  overlap: pose.overlap, error: pose.error, farOverlap: pose.farOverlap, scanPoints: scan.length,
  heightEstimated: specifiedHeight === undefined, savedAt: new Date().toISOString()
};
writeFileSync(file + '.alignment.json', JSON.stringify(alignment, null, 2) + '\n', { mode: 0o600 });
console.log('Saved reliable alignment:', JSON.stringify(alignment));
