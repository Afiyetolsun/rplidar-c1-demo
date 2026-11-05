export type PlanarPoint = [number, number];
export type SensorPose = { x: number; z: number; yaw: number };
export type RegistrationCandidate = SensorPose & { error: number; overlap: number; farOverlap: number };
export type RegistrationResult = {
  candidates: RegistrationCandidate[];
  ambiguous: boolean;
  reliable: boolean;
  scanPoints: number;
  mapPoints: number;
};

/** Bin repeated revolutions by bearing; people/noise do not gain extra weight. */
export function stableLidarSlice(frames: [number, number, number][][]): PlanarPoint[] {
  const bins: number[][] = Array.from({ length: 360 }, () => []);
  for (const points of frames) for (const [x, y] of points) {
    const distance = Math.hypot(x, y);
    if (!Number.isFinite(distance) || distance < 0.3 || distance > 12) continue;
    const bearing = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
    bins[Math.floor(bearing)].push(distance);
  }
  return bins.flatMap((distances, bearing): PlanarPoint[] => {
    if (distances.length < Math.max(2, frames.length / 3)) return [];
    distances.sort((a, b) => a - b);
    const distance = distances[Math.floor(distances.length / 2)];
    const angle = (bearing + 0.5) * Math.PI / 180;
    return [[Math.sin(angle) * distance, -Math.cos(angle) * distance]];
  });
}

class DistanceField {
  readonly resolution = 0.06;
  readonly minX: number;
  readonly minZ: number;
  readonly width: number;
  readonly height: number;
  readonly distances: Float32Array;
  readonly nearestX: Float32Array;
  readonly nearestZ: Float32Array;

  constructor(points: PlanarPoint[]) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of points) { minX = Math.min(minX, x); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z); }
    this.minX = minX - 0.5;
    this.minZ = minZ - 0.5;
    this.width = Math.ceil((maxX + 0.5 - this.minX) / this.resolution) + 1;
    this.height = Math.ceil((maxZ + 0.5 - this.minZ) / this.resolution) + 1;
    if (this.width * this.height > 1_000_000) throw new Error('Room is too large. Check its scale in metres.');
    const count = this.width * this.height;
    this.distances = new Float32Array(count).fill(1e6);
    this.nearestX = new Float32Array(count);
    this.nearestZ = new Float32Array(count);
    for (const [x, z] of points) {
      const index = this.index(x, z);
      if (index < 0) continue;
      this.distances[index] = 0;
      this.nearestX[index] = x; this.nearestZ[index] = z;
    }
    const relax = (index: number, other: number, cost: number) => {
      if (other < 0 || other >= count) return;
      const value = this.distances[other] + cost;
      if (value < this.distances[index]) {
        this.distances[index] = value;
        this.nearestX[index] = this.nearestX[other]; this.nearestZ[index] = this.nearestZ[other];
      }
    };
    for (let row = 0; row < this.height; row++) for (let column = 0; column < this.width; column++) {
      const i = row * this.width + column;
      if (column) relax(i, i - 1, 1);
      if (row) { relax(i, i - this.width, 1); if (column) relax(i, i - this.width - 1, Math.SQRT2); if (column + 1 < this.width) relax(i, i - this.width + 1, Math.SQRT2); }
    }
    for (let row = this.height - 1; row >= 0; row--) for (let column = this.width - 1; column >= 0; column--) {
      const i = row * this.width + column;
      if (column + 1 < this.width) relax(i, i + 1, 1);
      if (row + 1 < this.height) { relax(i, i + this.width, 1); if (column) relax(i, i + this.width - 1, Math.SQRT2); if (column + 1 < this.width) relax(i, i + this.width + 1, Math.SQRT2); }
    }
  }

  index(x: number, z: number) {
    const column = Math.round((x - this.minX) / this.resolution), row = Math.round((z - this.minZ) / this.resolution);
    return column >= 0 && row >= 0 && column < this.width && row < this.height ? row * this.width + column : -1;
  }

  distance(x: number, z: number) {
    const index = this.index(x, z);
    return index < 0 ? 1 : Math.hypot(x - this.nearestX[index], z - this.nearestZ[index]);
  }
}

function transformed(point: PlanarPoint, pose: SensorPose): PlanarPoint {
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  return [pose.x + c * point[0] + s * point[1], pose.z - s * point[0] + c * point[1]];
}

function score(points: PlanarPoint[], field: DistanceField, pose: SensorPose): RegistrationCandidate {
  const errors: number[] = [];
  let overlap = 0, far = 0, farMatched = 0;
  for (const point of points) {
    const [x, z] = transformed(point, pose);
    const distance = field.distance(x, z);
    errors.push(Math.min(distance, 0.6) ** 2);
    if (distance < 0.16) overlap++;
    if (Math.hypot(...point) > 1.5) { far++; if (distance < 0.16) farMatched++; }
  }
  errors.sort((a, b) => a - b);
  const count = Math.max(1, Math.ceil(errors.length * 0.85));
  return { ...pose, error: Math.sqrt(errors.slice(0, count).reduce((sum, value) => sum + value, 0) / count), overlap: overlap / points.length, farOverlap: far ? farMatched / far : 0 };
}

function cost(candidate: RegistrationCandidate) { return candidate.error + (1 - candidate.overlap) * 0.12 + (1 - candidate.farOverlap) * 0.06; }
function distinct(a: SensorPose, b: SensorPose) {
  const angle = Math.abs(Math.atan2(Math.sin(a.yaw - b.yaw), Math.cos(a.yaw - b.yaw)));
  return Math.hypot(a.x - b.x, a.z - b.z) > 0.5 || angle > 20 * Math.PI / 180;
}

/** Global translation/yaw search followed by robust nearest-point refinement.
 * The map is a horizontal slice, already scaled/aligned into room world axes.
 * Never estimate scale from one obstructed 2D scan.
 */
export function registerLidar(map: PlanarPoint[], scan: PlanarPoint[], hint?: { pose: SensorPose; radius: number }): RegistrationResult {
  if (map.length < 80 || scan.length < 35) throw new Error('Not enough room-slice or live-scan points to locate the sensor.');
  if (![...map, ...scan].every(p => p.every(Number.isFinite))) throw new Error('Invalid point coordinates.');
  const field = new DistanceField(map);
  const bounds = { minX: field.minX + 0.5, minZ: field.minZ + 0.5, maxX: field.minX + (field.width - 1) * field.resolution - 0.5, maxZ: field.minZ + (field.height - 1) * field.resolution - 0.5 };
  const sparse = scan.filter((_, index) => index % Math.max(1, Math.floor(scan.length / 100)) === 0);
  let seeds: RegistrationCandidate[] = [];
  const startX = hint ? Math.max(bounds.minX, hint.pose.x - hint.radius) : bounds.minX;
  const endX = hint ? Math.min(bounds.maxX, hint.pose.x + hint.radius) : bounds.maxX;
  const startZ = hint ? Math.max(bounds.minZ, hint.pose.z - hint.radius) : bounds.minZ;
  const endZ = hint ? Math.min(bounds.maxZ, hint.pose.z + hint.radius) : bounds.maxZ;
  for (let yaw = -Math.PI; yaw < Math.PI; yaw += Math.PI / 36) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const rotated = sparse.map(([x, z]): PlanarPoint => [c * x + s * z, -s * x + c * z]);
    for (let x = startX; x <= endX; x += 0.24) for (let z = startZ; z <= endZ; z += 0.24) {
      let sum = 0;
      for (const point of rotated) sum += Math.min(field.distance(x + point[0], z + point[1]), 0.5) ** 2;
      const error = sum / rotated.length;
      if (seeds.length < 32 || error < seeds.at(-1)!.error) {
        seeds.push({ x, z, yaw, error, overlap: 0, farOverlap: 0 });
        seeds.sort((a, b) => a.error - b.error); seeds = seeds.slice(0, 32);
      }
    }
  }
  const refined = seeds.map(seed => {
    let pose: SensorPose = { x: seed.x, z: seed.z, yaw: seed.yaw };
    // Solve the incremental planar rigid transform from trimmed correspondences.
    for (let iteration = 0; iteration < 24; iteration++) {
      const pairs = scan.map(point => {
        const source = transformed(point, pose), index = field.index(...source);
        if (index < 0) return undefined;
        const target: PlanarPoint = [field.nearestX[index], field.nearestZ[index]];
        return { source, target, error: Math.hypot(source[0] - target[0], source[1] - target[1]) };
      }).filter((pair): pair is NonNullable<typeof pair> => Boolean(pair) && pair!.error < 0.45).sort((a, b) => a.error - b.error);
      const keep = pairs.slice(0, Math.ceil(pairs.length * 0.85));
      if (keep.length < 25) break;
      const centre = (key: 'source' | 'target'): PlanarPoint => [keep.reduce((sum, p) => sum + p[key][0], 0) / keep.length, keep.reduce((sum, p) => sum + p[key][1], 0) / keep.length];
      const a = centre('source'), b = centre('target');
      let dot = 0, cross = 0;
      for (const pair of keep) {
        const ax = pair.source[0] - a[0], az = pair.source[1] - a[1], bx = pair.target[0] - b[0], bz = pair.target[1] - b[1];
        dot += ax * bx + az * bz; cross += ax * bz - az * bx;
      }
      const delta = -Math.atan2(cross, dot), c = Math.cos(delta), s = Math.sin(delta);
      const dx = b[0] - c * a[0] - s * a[1], dz = b[1] + s * a[0] - c * a[1];
      const next = { x: c * pose.x + s * pose.z + dx, z: -s * pose.x + c * pose.z + dz, yaw: pose.yaw + delta };
      if (hint && Math.hypot(next.x - hint.pose.x, next.z - hint.pose.z) > hint.radius + 0.1) break;
      const movement = Math.hypot(next.x - pose.x, next.z - pose.z) + Math.abs(delta);
      pose = next;
      if (movement < 0.001) break;
    }
    // Trimmed ICP can favor nearby furniture over distant walls. Finish against
    // the complete scan score so large-radius returns also constrain heading.
    let best = score(scan, field, pose);
    for (const [translationStep, angleStep] of [[0.06, Math.PI / 180], [0.025, Math.PI / 450], [0.01, Math.PI / 1200]]) {
      for (let iteration = 0; iteration < 12; iteration++) {
        let next = best;
        for (const [dx, dz, dyaw] of [[translationStep, 0, 0], [-translationStep, 0, 0], [0, translationStep, 0], [0, -translationStep, 0], [0, 0, angleStep], [0, 0, -angleStep]]) {
          const candidatePose = { x: best.x + dx, z: best.z + dz, yaw: best.yaw + dyaw };
          if (hint && Math.hypot(candidatePose.x - hint.pose.x, candidatePose.z - hint.pose.z) > hint.radius + 0.1) continue;
          const candidate = score(scan, field, candidatePose);
          if (cost(candidate) < cost(next)) next = candidate;
        }
        if (next === best) break;
        best = next;
      }
    }
    return best;
  }).sort((a, b) => cost(a) - cost(b));
  const candidates: RegistrationCandidate[] = [];
  for (const candidate of refined) if (candidates.every(other => distinct(other, candidate))) candidates.push(candidate);
  const best = candidates[0];
  if (!best) throw new Error('No placement inside the room matches this scan. Check the room scale and sensor height.');
  const ambiguous = Boolean(candidates[1] && cost(candidates[1]) - cost(best) < 0.025);
  const meanX = scan.reduce((sum, p) => sum + p[0], 0) / scan.length, meanZ = scan.reduce((sum, p) => sum + p[1], 0) / scan.length;
  let xx = 0, zz = 0, xz = 0;
  for (const [x, z] of scan) { xx += (x - meanX) ** 2; zz += (z - meanZ) ** 2; xz += (x - meanX) * (z - meanZ); }
  const nonCollinear = (xx * zz - xz ** 2) / (xx + zz) ** 2 > 0.01;
  const reliable = !ambiguous && nonCollinear && best.overlap >= 0.65 && best.farOverlap >= 0.55 && best.error <= 0.14;
  return { candidates: candidates.slice(0, 4), ambiguous, reliable, scanPoints: scan.length, mapPoints: map.length };
}
