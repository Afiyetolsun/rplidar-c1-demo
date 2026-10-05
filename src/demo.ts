import type { LidarFrame } from './shared.js';

/** Entirely procedural rectangle and circle. No measured room data or recordings. */
export function demoFrame(distance: number, frameNumber: number, now: number): LidarFrame {
  const cx = 0.25, cy = Math.sqrt(Math.max(0, distance * distance - cx * cx)), radius = 0.22;
  const points: LidarFrame['points'] = [];
  for (let i = 0; i < 720; i++) {
    const angle = i * Math.PI / 360, dx = Math.sin(angle), dy = Math.cos(angle);
    let depth = Math.min(Math.abs(4.5 / dx), Math.abs(7 / dy));
    const projection = cx * dx + cy * dy;
    const discriminant = projection * projection - (cx * cx + cy * cy - radius * radius);
    if (discriminant >= 0 && projection > 0) depth = Math.min(depth, projection - Math.sqrt(discriminant));
    points.push([dx * depth, dy * depth, 0]);
  }
  return { kind: 'lidar', frameNumber, timestamp: now, receivedAt: now, points, targets: [{ id: 1, x: cx, y: cy, z: 0 }] };
}
