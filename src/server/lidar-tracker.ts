import type { LidarFrame } from '../shared.js';

export type PolarSample = [angleDegrees: number, distanceMetres: number];
type Observation = { x: number; y: number; at: number };
type Track = { id: number; x: number; y: number; seen: number; history: Observation[]; lastMotionAt?: number; motionVector?: { x: number; y: number } };

/** Require a sustained trajectory, rather than a cluster appearing or jittering. */
export function coherentMotion(history: Observation[]): boolean {
  if (history.length < 6) return false;
  const elapsed = (history.at(-1)!.at - history[0].at) / 1000;
  if (elapsed < 0.4 || elapsed > 1.5) return false;
  const mean = (samples: Observation[], key: 'x' | 'y') => samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length;
  const first = history.slice(0, 3), last = history.slice(-3);
  if (Math.hypot(mean(last, 'x') - mean(first, 'x'), mean(last, 'y') - mean(first, 'y')) < 0.14) return false;
  const meanX = mean(history, 'x'), meanY = mean(history, 'y');
  const times = history.map(sample => (sample.at - history[0].at) / 1000);
  const meanTime = times.reduce((sum, t) => sum + t, 0) / times.length;
  let tt = 0, tx = 0, ty = 0, scatter = 0;
  history.forEach((sample, i) => {
    const dt = times[i] - meanTime, dx = sample.x - meanX, dy = sample.y - meanY;
    tt += dt * dt; tx += dt * dx; ty += dt * dy; scatter += dx * dx + dy * dy;
  });
  if (tt <= 0 || scatter <= 0) return false;
  const speed = Math.hypot(tx, ty) / tt;
  const coherence = (tx * tx + ty * ty) / (tt * scatter);
  return speed >= 0.12 && speed <= 3.5 && speed * elapsed >= 0.18 && coherence >= 0.7;
}
const BINS = 720;
const CALIBRATION_FRAMES = 24;

export function polarPoint([angle, distance]: PolarSample): [number, number, number] {
  const radians = angle * Math.PI / 180;
  return [Math.sin(radians) * distance, Math.cos(radians) * distance, 0];
}

/** Automatic or explicit empty-room background. Detects changed objects, not human identity. */
export class LidarTracker {
  private background: (number | undefined)[] = [];
  private calibration: number[][] | undefined;
  private calibrationFrames = 0;
  private tracks: Track[] = [];
  private nextId = 1;
  private calibrationLength = CALIBRATION_FRAMES;
  private automatic = false;
  private farther: { distance: number; hits: number }[] = [];
  private foregroundPoints = 0;
  private clusterCount = 0;
  get mode(): 'automatic' | 'empty-room' { return this.automatic ? 'automatic' : 'empty-room'; }
  get diagnostics() { return { backgroundCoverage: this.background.filter(v => v !== undefined).length / BINS, foregroundPoints: this.foregroundPoints, clusters: this.clusterCount }; }

  get calibrated() { return this.background.length === BINS; }
  get progress() { return this.calibration ? this.calibrationFrames / this.calibrationLength : null; }

  reset() { this.background = []; this.calibration = undefined; this.tracks = []; this.nextId = 1; this.farther = []; this.foregroundPoints = this.clusterCount = 0; }
  calibrate(automatic = false) {
    this.automatic = automatic;
    this.calibrationLength = automatic ? 40 : CALIBRATION_FRAMES;
    this.farther = [];
    this.foregroundPoints = this.clusterCount = 0;
    this.background = [];
    this.tracks = [];
    this.calibration = Array.from({ length: BINS }, () => []);
    this.calibrationFrames = 0;
  }

  update(samples: PolarSample[], now: number): LidarFrame['targets'] {
    if (this.calibration) {
      for (const [angle, distance] of samples) this.calibration[this.bin(angle)].push(distance);
      if (++this.calibrationFrames >= this.calibrationLength) {
        this.background = this.calibration.map(values => {
          if (values.length < 4) return undefined;
          values.sort((a, b) => a - b);
          return values[Math.min(values.length - 1, Math.floor(values.length * (this.automatic ? 0.8 : 0.5)))];
        });
        this.calibration = undefined;
      }
      return [];
    }
    if (!this.calibrated) return [];
    this.foregroundPoints = this.clusterCount = 0;
    // Keep angular continuity: a run must be closer than the empty-room surface.
    const groups: [number, number, number][][] = [];
    let group: [number, number, number][] = [];
    let previousAngle: number | undefined;
    const sorted = [...samples].sort((a, b) => a[0] - b[0]);
    for (const sample of sorted) {
      const [angle, distance] = sample;
      const bin = this.bin(angle);
      if (this.automatic) this.learnRevealedSurface(bin, distance);
      const backgrounds = [-1, 0, 1].map(offset => this.background[(bin + offset + BINS) % BINS]).filter((value): value is number => value !== undefined);
      const foreground = backgrounds.length && distance >= 0.15 && distance <= 12 && Math.min(...backgrounds) - distance > 0.22;
      const point = polarPoint(sample);
      const last = group.at(-1);
      if (!foreground || last && (Math.hypot(point[0] - last[0], point[1] - last[1]) > 0.24 || angle - previousAngle! > 2.5)) {
        if (group.length) groups.push(group);
        group = [];
      }
      if (foreground) { group.push(point); this.foregroundPoints++; }
      previousAngle = angle;
    }
    if (group.length) groups.push(group);
    // A person can straddle 359°/0°. Merge before applying size limits.
    if (groups.length > 1) {
      const first = groups[0], last = groups.at(-1)!;
      if (Math.hypot(first[0][0] - last.at(-1)![0], first[0][1] - last.at(-1)![1]) < 0.24) {
        groups[0] = [...last, ...first]; groups.pop();
      }
    }
    // Occlusion by furniture can split one body into nearby angular fragments.
    // Join adjacent fragments before deciding how many independent tracks exist.
    for (let i = 0; i < groups.length - 1; i++) {
      const a = groups[i], b = groups[i + 1];
      const gap = Math.hypot(a.at(-1)![0] - b[0][0], a.at(-1)![1] - b[0][1]);
      if (gap > 0.3) continue;
      const merged = [...a, ...b];
      const xs = merged.map(p => p[0]), ys = merged.map(p => p[1]);
      if (Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) > 1.3) continue;
      groups.splice(i, 2, merged); i--;
    }
    const clusters = groups.filter(points => {
      if (points.length < 3) return false;
      const width = Math.hypot(points[0][0] - points.at(-1)![0], points[0][1] - points.at(-1)![1]);
      return width >= 0.09 && width <= 1.3;
    }).map(points => ({ x: points.reduce((sum, point) => sum + point[0], 0) / points.length, y: points.reduce((sum, point) => sum + point[1], 0) / points.length }));
    this.clusterCount = clusters.length;
    const available = this.tracks.filter(track => now - track.seen <= 300);
    const matched = new Set<number>();
    const next: Track[] = [];
    for (const cluster of clusters.slice(0, 32)) {
      const candidate = available.filter(track => !matched.has(track.id)).sort((a, b) => Math.hypot(a.x - cluster.x, a.y - cluster.y) - Math.hypot(b.x - cluster.x, b.y - cluster.y))[0];
      if (candidate && Math.hypot(candidate.x - cluster.x, candidate.y - cluster.y) < 0.45 + (now - candidate.seen) / 1000 * 2) {
        matched.add(candidate.id);
        const history = [...candidate.history.filter(sample => now - sample.at <= 1200), { ...cluster, at: now }].slice(-12);
        const moving = coherentMotion(history);
        const lastMotionAt = moving ? now : candidate.lastMotionAt;
        const dt = (history.at(-1)!.at - history[0].at) / 1000;
        const motionVector = moving ? { x: (history.at(-1)!.x - history[0].x) / dt, y: (history.at(-1)!.y - history[0].y) / dt } : candidate.motionVector;
        next.push({ id: candidate.id, x: candidate.x * 0.25 + cluster.x * 0.75, y: candidate.y * 0.25 + cluster.y * 0.75, seen: now, history, lastMotionAt, motionVector });
      } else next.push({ id: this.nextId++, ...cluster, seen: now, history: [{ ...cluster, at: now }] });
    }
    this.tracks = [...next, ...available.filter(track => !matched.has(track.id))].filter((track, index, tracks) => tracks.findIndex(other => other.id === track.id) === index);
    // Do not display extrapolated tracks after a missing detection.
    const confirmed = next.filter(track => track.lastMotionAt !== undefined);
    const bodies: Track[][] = [];
    for (const track of confirmed) {
      // Separate limbs can remain separated by a large scan gap. Merge only
      // fragments that independently passed motion confirmation and moved
      // together, so a nearby stationary chair cannot join a person's track.
      const body = bodies.find(group => group.every(other => {
        if (Math.hypot(other.x - track.x, other.y - track.y) > 0.8 || !other.motionVector || !track.motionVector) return false;
        const a = other.motionVector, b = track.motionVector;
        const sa = Math.hypot(a.x, a.y), sb = Math.hypot(b.x, b.y);
        return sa > 0 && sb > 0 && Math.min(sa, sb) / Math.max(sa, sb) > 0.4 && (a.x * b.x + a.y * b.y) / (sa * sb) > 0.8;
      }));
      if (body) body.push(track); else bodies.push([track]);
    }
    return bodies.map(body => ({ id: Math.min(...body.map(track => track.id)), x: body.reduce((sum, track) => sum + track.x, 0) / body.length, y: body.reduce((sum, track) => sum + track.y, 0) / body.length, z: 0 }));
  }

  private learnRevealedSurface(bin: number, distance: number) {
    const background = this.background[bin];
    if (background !== undefined && distance <= background + 0.22) { this.farther[bin] = { distance, hits: 0 }; return; }
    const previous = this.farther[bin];
    const hits = previous && Math.abs(previous.distance - distance) < 0.12 ? previous.hits + 1 : 1;
    this.farther[bin] = { distance, hits };
    // Expand only after repeated stable farther returns. Never absorb a stopped
    // foreground object or turn a single long-range outlier into a room surface.
    if (hits >= 6) this.background[bin] = distance;
  }

  private bin(angle: number) { return Math.floor(((angle % 360 + 360) % 360) * 2) % BINS; }
}
