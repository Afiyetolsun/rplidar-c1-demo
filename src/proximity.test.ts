import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoFrame } from './demo.js';
import { nearestContact, proximityBeepInterval } from './proximity.js';

test('sound has no contact after a stale frame or a frame without tracks', () => {
  const frame = demoFrame(3, 1, 10000);
  assert.ok(nearestContact(frame, 10000));
  assert.equal(nearestContact(frame, 11801), undefined);
  assert.equal(nearestContact({ ...frame, targets: [] }, 10000), undefined);
  assert.equal(nearestContact(undefined, 10000), undefined);
});
test('pulse rate accelerates monotonically and clamps beyond the demo range', () => {
  assert.equal(proximityBeepInterval(6), 1700);
  assert.equal(proximityBeepInterval(0.5), 170);
  assert.equal(proximityBeepInterval(20), 1700);
  assert.equal(proximityBeepInterval(0), 170);
  assert.ok(proximityBeepInterval(2) < proximityBeepInterval(4));
});
test('procedural demo measures the selected distance and occludes the synthetic wall', () => {
  const frame = demoFrame(2, 1, 10000);
  assert.equal(frame.points.length, 720);
  assert.ok(frame.points.every(p => p.every(Number.isFinite)));
  assert.ok(Math.abs(nearestContact(frame, 10000)!.distance - 2) < 1e-9);
  assert.ok(frame.points.some(([x, y]) => Math.hypot(x, y) < 2));
});
