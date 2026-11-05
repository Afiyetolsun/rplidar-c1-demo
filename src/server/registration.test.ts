import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerLidar, stableLidarSlice, type PlanarPoint, type SensorPose } from './registration.js';

function segment(a: PlanarPoint, b: PlanarPoint): PlanarPoint[] {
  return Array.from({ length: 101 }, (_, i) => [a[0] + (b[0] - a[0]) * i / 100, a[1] + (b[1] - a[1]) * i / 100]);
}
function local(points: PlanarPoint[], pose: SensorPose): PlanarPoint[] {
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  return points.map(([x, z]) => [c * (x - pose.x) - s * (z - pose.z), s * (x - pose.x) + c * (z - pose.z)]);
}
const room = [...segment([-3, -5], [2, -5]), ...segment([2, -5], [2, 0]), ...segment([2, 0], [-3, 0]), ...segment([-3, 0], [-3, -5]), ...segment([-1.5, -4], [-0.2, -4]), ...segment([-0.2, -4], [-0.2, -3.1])];

test('registration recovers metric translation and yaw from an asymmetric partial scan with outliers', () => {
  const pose = { x: -0.8, z: -3.2, yaw: -2.6 };
  const scan = local(room.filter((_, i) => i % 2 === 0), pose).map(([x, z], i): PlanarPoint => [x + Math.sin(i) * 0.015, z + Math.cos(i) * 0.015]);
  for (let i = 0; i < 20; i++) scan.push([0.4 + i * 0.025, -0.6]);
  const result = registerLidar(room, scan);
  assert.ok(Math.hypot(result.candidates[0].x - pose.x, result.candidates[0].z - pose.z) < 0.1);
  assert.ok(Math.abs(result.candidates[0].yaw - pose.yaw) < 0.05);
  assert.equal(result.reliable, true);
});
test('a symmetric square exposes competing placements instead of certifying one', () => {
  const square = [...segment([-2, -2], [2, -2]), ...segment([2, -2], [2, 2]), ...segment([2, 2], [-2, 2]), ...segment([-2, 2], [-2, -2])];
  const result = registerLidar(square, local(square, { x: 0.6, z: -0.8, yaw: 0.7 }));
  assert.equal(result.ambiguous, true);
  assert.equal(result.reliable, false);
});
test('incorrect room scale cannot pass fit quality and insufficient scans are rejected', () => {
  const result = registerLidar(room, local(room, { x: 0, z: -3, yaw: 0.5 }).map(([x, z]) => [x * 2, z * 2]));
  assert.equal(result.reliable, false);
  assert.throws(() => registerLidar(room, [[0, -1]]), /Not enough/);
});
test('bearing medians reject one-frame obstructions and preserve rear returns', () => {
  const frames: [number, number, number][][] = Array.from({ length: 6 }, (_, i) => [[0, i === 0 ? 0.4 : 2, 0], [0, -3, 0], [Number.NaN, 2, 0]]);
  const points = stableLidarSlice(frames);
  assert.equal(points.length, 2);
  assert.ok(points[0][1] < -1.99);
  assert.ok(points[1][1] > 2.99);
});

test('one straight surface cannot certify a sensor position', () => {
  const wall = segment([-3, -4], [3, -4]);
  const result = registerLidar(wall, local(wall, { x: 0.3, z: -2, yaw: 0.2 }));
  assert.equal(result.reliable, false);
});
