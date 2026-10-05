import type { LidarFrame } from './shared.js';
import { STALE_MS } from './shared.js';

/** Same pulse curve as the original experiment: 0.59 to 5.88 Hz. */
export function proximityBeepInterval(distance: number): number {
  const proximity = Math.max(0, Math.min(1, (6 - distance) / 5.5));
  return 1700 - Math.pow(proximity, 1.45) * 1530;
}

export function nearestContact(frame: LidarFrame | undefined, now: number) {
  if (!frame || Math.abs(now - frame.timestamp) > STALE_MS) return undefined;
  return frame.targets.filter(t => Number.isFinite(t.x) && Number.isFinite(t.y))
    .map(t => ({ ...t, distance: Math.hypot(t.x, t.y) }))
    .sort((a, b) => a.distance - b.distance)[0];
}
