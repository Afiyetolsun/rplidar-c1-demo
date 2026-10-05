import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coherentMotion, LidarTracker, polarPoint, type PolarSample } from './lidar-tracker.js';

const room = (): PolarSample[] => Array.from({ length: 720 }, (_, i) => [i / 2, 5]);
function calibrated(automatic = false) {
  const tracker = new LidarTracker(); tracker.calibrate(automatic);
  for (let i = 0; i < (automatic ? 40 : 24); i++) assert.deepEqual(tracker.update(room(), i * 100), []);
  assert.equal(tracker.calibrated, true);
  return tracker;
}
function body(distance: number, behind = false): PolarSample[] {
  return room().map(([angle, d]) => [angle, (behind ? angle > 174 && angle < 186 : angle < 6 || angle > 354) ? distance : d]);
}
function approach(tracker: LidarTracker, behind = false, startAt = 5000) {
  let targets: ReturnType<LidarTracker['update']> = [];
  for (let i = 0; i < 12; i++) targets = tracker.update(body(3 - i * 0.07, behind), startAt + i * 100);
  assert.equal(targets.length, 1);
  return targets[0];
}

test('C1 axes preserve all quadrants and metre scale', () => {
  assert.deepEqual(polarPoint([0, 2]), [0, 2, 0]);
  assert.ok(Math.abs(polarPoint([90, 2])[0] - 2) < 1e-9);
  assert.ok(Math.abs(polarPoint([180, 2])[1] + 2) < 1e-9);
});
test('walls, isolated returns and uncalibrated scans do not create tracks', () => {
  assert.deepEqual(new LidarTracker().update(room(), 0), []);
  const tracker = calibrated();
  for (let i = 0; i < 20; i++) {
    const samples = room(); samples[60][1] = 2;
    assert.deepEqual(tracker.update(samples, 5000 + i * 100), []);
  }
});
test('static chairs and persistent noisy clusters do not become moving contacts', () => {
  for (const automatic of [false, true]) {
    const tracker = calibrated(automatic);
    for (let i = 0; i < 100; i++) {
      const samples = room().map(([a, d]): PolarSample => [a, a > 50 && a < 60 ? 2 + Math.sin(i * 1.7) * 0.06 : a > 150 && a < 160 ? 3 + Math.cos(i * 2.3) * 0.08 : d]);
      assert.deepEqual(tracker.update(samples, 5000 + i * 100), []);
    }
  }
});
test('coherent trajectories pass while centroid jumps and oscillation are rejected', () => {
  const series = (fn: (i: number) => number) => Array.from({ length: 12 }, (_, i) => ({ x: 0, y: fn(i), at: 1000 + i * 100 }));
  assert.equal(coherentMotion(series(i => 3 - i * 0.05)), true);
  assert.equal(coherentMotion(series(i => 2 + (i === 10 ? 0.7 : 0))), false);
  assert.equal(coherentMotion(series(i => 2 + Math.sin(i * 2) * 0.25)), false);
  assert.equal(coherentMotion(series(i => 2 + i * 0.5)), false);
});
test('approach across 0 degrees confirms once, retains a stopped person and clears when absent', () => {
  const tracker = calibrated();
  const target = approach(tracker);
  assert.ok(Math.abs(target.x) < 0.1 && target.y > 2 && target.y < 2.4);
  assert.equal(tracker.update(body(2.23), 6200)[0].id, target.id);
  assert.deepEqual(tracker.update(room(), 6300), []);
  tracker.calibrate();
  assert.equal(tracker.calibrated, false);
});
test('moving foreground behind C1 remains behind; wide surfaces are rejected', () => {
  const tracker = calibrated();
  assert.ok(approach(tracker, true).y < -2);
  for (let i = 0; i < 15; i++) assert.deepEqual(tracker.update(room().map(([a, d]) => [a, a > 90 && a < 150 ? 3 - i * 0.05 : d]), 7000 + i * 100), []);
});
test('automatic startup handles brief occlusions and detects approach without manual calibration', () => {
  const tracker = new LidarTracker(); tracker.calibrate(true);
  for (let i = 0; i < 40; i++) assert.deepEqual(tracker.update(i < 10 ? body(2) : room(), i * 100), []);
  assert.equal(tracker.mode, 'automatic');
  assert.equal(tracker.diagnostics.backgroundCoverage, 1);
  const target = approach(tracker);
  let last: ReturnType<LidarTracker['update']> = [];
  for (let i = 0; i < 40; i++) last = tracker.update(body(2.23), 6200 + i * 100);
  assert.equal(last.length, 1); // Motion is required only for initial confirmation.
  assert.equal(last[0].id, target.id);
  assert.deepEqual(tracker.update(room(), 10150), []); // Visibility still gates output, so an absent person is never retained.
  for (let i = 0; i < 12; i++) last = tracker.update(body(2.23 + i * 0.05), 10200 + i * 100);
  assert.equal(last[0].id, target.id);
});
test('automatic startup learns surfaces revealed after an initially stationary occlusion', () => {
  const tracker = new LidarTracker(); tracker.calibrate(true);
  for (let i = 0; i < 40; i++) tracker.update(body(2), i * 100);
  assert.deepEqual(tracker.update(body(2), 4100), []);
  for (let i = 0; i < 8; i++) tracker.update(room(), 4200 + i * 100);
  assert.ok(approach(tracker, false, 5100));
});
test('single farther outlier cannot produce a stationary false contact', () => {
  const tracker = calibrated(true);
  tracker.update(body(9), 4100);
  for (let i = 0; i < 20; i++) assert.deepEqual(tracker.update(room(), 4200 + i * 100), []);
});
test('a moving torso with sparse returns is confirmed', () => {
  const tracker = calibrated();
  let targets: ReturnType<LidarTracker['update']> = [];
  for (let i = 0; i < 12; i++) {
    const samples = room().filter((_, index) => index % 2 === 0).map(([a, d]): PolarSample => [a, a >= 50 && a <= 52 ? 3.5 - i * 0.04 : d]);
    targets = tracker.update(samples, 5000 + i * 100);
  }
  assert.equal(targets.length, 1);
});
test('nearby occluded body fragments form one moving target rather than duplicate contacts', () => {
  const tracker = calibrated();
  let targets: ReturnType<LidarTracker['update']> = [];
  for (let i = 0; i < 12; i++) {
    const samples = room().map(([a, d]): PolarSample => [a, a >= 45 && a <= 48 || a >= 51 && a <= 54 ? 3 - i * 0.06 : d]);
    targets = tracker.update(samples, 5000 + i * 100);
  }
  assert.equal(targets.length, 1);
});
test('two separated moving objects retain distinct IDs', () => {
  const tracker = calibrated();
  let targets: ReturnType<LidarTracker['update']> = [];
  for (let i = 0; i < 12; i++) targets = tracker.update(room().map(([a, d]) => [a, a > 45 && a < 55 || a > 135 && a < 145 ? 3 - i * 0.06 : d]), 5000 + i * 100);
  assert.equal(targets.length, 2);
  assert.notEqual(targets[0].id, targets[1].id);
});

test('separated limbs with coordinated motion remain one target after stopping', () => {
  const tracker = calibrated();
  const fragments = (left: number, right: number): PolarSample[] => room().map(([a, d]) => [a, a >= 45 && a <= 49 ? left : a >= 60 && a <= 64 ? right : d]);
  let targets: ReturnType<LidarTracker['update']> = [];
  for (let i = 0; i < 12; i++) targets = tracker.update(fragments(3 - i * 0.06, 3 - i * 0.06), 5000 + i * 100);
  assert.equal(targets.length, 1);
  const id = targets[0].id;
  for (let i = 0; i < 60; i++) {
    targets = tracker.update(fragments(2.34, 2.34), 6200 + i * 100);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].id, id);
  }
});

test('nearby objects moving in opposite directions are not merged', () => {
  const tracker = calibrated();
  let targets: ReturnType<LidarTracker['update']> = [];
  for (let i = 0; i < 12; i++) targets = tracker.update(room().map(([a, d]) => [a, a >= 45 && a <= 49 ? 3 - i * 0.04 : a >= 60 && a <= 64 ? 2.3 + i * 0.04 : d]), 5000 + i * 100);
  assert.equal(targets.length, 2);
});
