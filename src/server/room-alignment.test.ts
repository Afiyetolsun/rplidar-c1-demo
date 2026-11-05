import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadRoomAlignment } from './room-alignment.js';

test('saved pose is restored only for the matching room and valid fit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'room-pose-')), file = join(dir, 'scan.ply');
  try {
    writeFileSync(file, 'synthetic-room');
    const pose = { version: 1, roomSha256: createHash('sha256').update('synthetic-room').digest('hex'), x: 1, z: -2, yaw: 35, height: 1, overlap: .9, error: .04 };
    const save = (value: unknown) => writeFileSync(file + '.alignment.json', JSON.stringify(value));
    assert.equal(loadRoomAlignment(file), undefined);
    save(pose); assert.equal(loadRoomAlignment(file)?.yaw, 35);
    for (const patch of [{ roomSha256: 'wrong' }, { height: -1 }, { overlap: .1 }, { error: .4 }, { x: null }]) {
      save({ ...pose, ...patch }); assert.equal(loadRoomAlignment(file), undefined);
    }
    save(pose); writeFileSync(file, 'a-different-room'); assert.equal(loadRoomAlignment(file), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('inverse room placement maps the registered sensor to origin and preserves ranges', () => {
  const x = -.5, z = -1.7, yaw = -2.4, c = Math.cos(yaw), s = Math.sin(yaw);
  const tx = -c*x+s*z, tz = -s*x-c*z;
  const roomPoint = [x+c*.8+s*(-2), z-s*.8+c*(-2)];
  const local = [tx+c*roomPoint[0]-s*roomPoint[1], tz+s*roomPoint[0]+c*roomPoint[1]];
  assert.ok(Math.abs(local[0]-.8)<1e-10); assert.ok(Math.abs(local[1]+2)<1e-10);
});
