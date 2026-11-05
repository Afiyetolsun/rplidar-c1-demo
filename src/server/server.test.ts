import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

let child: ChildProcess;
let url: string;
before(async () => {
  child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, C1_DEMO_PORT: '0' } });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Local API did not start')), 10000);
    let output = '';
    child.stdout!.on('data', data => {
      output += String(data);
      const match = output.match(/RPLIDAR C1 Demo: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { url = match[1]; clearTimeout(timeout); resolve(); }
    });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`API exited ${code} before starting`)); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
  });
});
after(async () => {
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
});
test('local API starts disconnected and exposes no capture or adapter-ingest API', async () => {
  const response = await fetch(`${url}/api/lidar/status`), status = await response.json();
  assert.equal(response.status, 200); assert.equal(status.connected, false); assert.equal(status.serialNumber, undefined);
  assert.equal((await fetch(`${url}/api/capture`)).status, 404);
  assert.deepEqual(await fetch(`${url}/api/room`).then(r => r.json()), { available: false });
  assert.equal((await fetch(`${url}/api/room/cloud`)).status, 404);
  assert.equal((await fetch(`${url}/api/room/cloud`, { headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal((await fetch(`${url}/api/lidar/frame`, { method: 'POST' })).status, 404);
});
test('foreign origins cannot use the local device API; invalid ports do not start the bridge', async () => {
  assert.equal((await fetch(`${url}/api/ports`, { headers: { Origin: 'https://example.com' } })).status, 403);
  const response = await fetch(`${url}/api/lidar/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port: '/not-a-device' }) });
  assert.equal(response.status, 400);
  assert.equal((await fetch(`${url}/api/lidar/status`).then(r => r.json())).connected, false);
  assert.equal((await fetch(`${url}/api/lidar/calibrate`, { method: 'POST' })).status, 400);
});
test('WebSocket sends only disconnected C1 status before hardware connection', async () => {
  const socket = new WebSocket(`${url.replace('http:', 'ws:')}/ws`, { origin: url });
  try {
    const [data] = await once(socket, 'message');
    const status = JSON.parse(String(data));
    assert.equal(status.kind, 'lidar-status'); assert.equal(status.connected, false); assert.equal(status.serialNumber, undefined);
  } finally { const closed = once(socket, 'close'); socket.close(); await closed; }
});

test('foreign origins cannot open the local WebSocket', async () => {
  const socket = new WebSocket(`${url.replace('http:', 'ws:')}/ws`, { origin: 'https://example.com' });
  socket.on('error', () => { /* Rejected handshakes emit an error when terminated. */ });
  try {
    const [, response] = await once(socket, 'unexpected-response');
    assert.equal(response.statusCode, 401);
    response.resume();
  } finally { const closed = new Promise<void>(resolve => socket.once('close', () => resolve())); socket.terminate(); await closed; }
});

test('explicit room asset in a hidden local directory is served only on the protected route', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'c1-room-'));
  const hidden = join(dir, '.private'); await mkdir(hidden);
  const asset = join(hidden, 'fixture.ply');
  const bytes = 'ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n';
  await writeFile(asset, bytes);
  const processUnderTest = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, C1_DEMO_PORT: '0', C1_ROOM_FILE: asset, C1_LIDAR_PORT: '', FIREFLY_CONFIG: '' } });
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Room server startup timed out')), 10000);
      let output = '';
      processUnderTest.stdout!.on('data', data => {
        output += String(data); const match = output.match(/RPLIDAR C1 Demo: (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      processUnderTest.once('error', error => { clearTimeout(timer); reject(error); });
      processUnderTest.once('exit', () => { clearTimeout(timer); reject(new Error('Room server exited')); });
    });
    assert.deepEqual(await fetch(`${endpoint}/api/room`).then(r => r.json()), { available: true });
    const response = await fetch(`${endpoint}/api/room/cloud`);
    assert.equal(response.status, 200); assert.equal(await response.text(), bytes);
    assert.equal((await fetch(`${endpoint}/api/room/cloud`, { headers: { Origin: 'https://example.com' } })).status, 403);
  } finally {
    if (processUnderTest.exitCode === null) { const done = once(processUnderTest, 'exit'); processUnderTest.kill('SIGTERM'); await done; }
    await rm(dir, { recursive: true, force: true });
  }
});
