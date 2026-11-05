import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFirefly, FIREFLY_PACKET_SIZE } from './firefly.js';
import type { LidarFrame, LidarStatus } from '../shared.js';
const key = Buffer.alloc(16, 42);
const status: LidarStatus = { kind: 'lidar-status', connected: true, streaming: true, message: '', frames: 1, points: 3, hz: 10, calibrated: true, calibrationProgress: null };
const frame: LidarFrame = { kind: 'lidar', frameNumber: 1, timestamp: 1000, receivedAt: 1000, points: [[0, 2, 0], [0, 1, 0], [-1, 0, 0]], targets: [{ id: 1, x: 3, y: 4, z: 0 }, { id: 2, x: -1, y: 0, z: 0 }] };
test('wire format preserves coordinates, nearest contact, pairing and scan-bin minimum', () => {
  const p = encodeFirefly(key, 123, 456, status, frame, 1100);
  assert.equal(p.length, FIREFLY_PACKET_SIZE); assert.equal(p.subarray(0,4).toString(), 'FFH1');
  assert.deepEqual(p.subarray(4,20), key); assert.equal(p.readUInt32LE(20), 123); assert.equal(p.readUInt32LE(24),456);
  assert.equal(p[28],2); assert.equal(p[29],2); assert.equal(p.readUInt16LE(32),1000);
  assert.equal(p.readUInt16LE(36),1000); assert.equal(p.readInt16LE(180),-1000); assert.equal(p.readInt16LE(182),0);
});
test('stale, disconnected and missing scans cannot retain contacts or geometry', () => {
  for (const p of [encodeFirefly(key,1,1,status,frame,2800),encodeFirefly(key,1,1,{...status,connected:false},frame,1100),encodeFirefly(key,1,1,status,undefined,1100)]) {
    assert.equal(p[28],0); assert.equal(p[29],0); assert.equal(p.readUInt16LE(32),65535); assert.ok(p.subarray(36).every(x=>x===0));
  }
});
test('calibration suppresses contacts; invalid and excessive targets are bounded', () => {
  const learning=encodeFirefly(key,1,1,{...status,calibrated:false,calibrationProgress:.5},frame,1100);
  assert.equal(learning[28],1); assert.equal(learning[29],0); assert.equal(learning[30],50);
  const crowded={...frame,targets:[{id:0,x:NaN,y:0,z:0},...Array.from({length:20},(_,id)=>({id,x:id+1,y:0,z:0}))]};
  const p=encodeFirefly(key,1,1,status,crowded,1100);assert.equal(p[29],8);assert.equal(p.readUInt16LE(32),1000);
});

test('single and multiple displays retain independent host/key pairs', async () => {
  const { parseFireflyDevices } = await import('./firefly.js');
  const first = { host: '192.0.2.1', key: 'aa'.repeat(16) };
  const second = { host: '192.0.2.2', key: 'bb'.repeat(16) };
  assert.deepEqual(parseFireflyDevices(undefined), []);
  assert.deepEqual(parseFireflyDevices(first), [first]);
  assert.deepEqual(parseFireflyDevices([first, second]), [first, second]);
  for (const invalid of [null, { ...first, host: '' }, [first, { ...second, key: 'bad' }]]) {
    assert.throws(() => parseFireflyDevices(invalid));
  }
});
