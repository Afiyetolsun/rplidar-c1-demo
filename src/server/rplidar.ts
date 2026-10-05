import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { LidarFrame, LidarStatus } from '../shared.js';
import { LidarTracker, polarPoint, type PolarSample } from './lidar-tracker.js';

export class RplidarC1 {
  private child?: ChildProcessWithoutNullStreams;
  private tracker = new LidarTracker();
  private lastFrameAt = 0;
  private status: LidarStatus = { kind: 'lidar-status', connected: false, streaming: false, message: 'C1 disconnected', frames: 0, points: 0, hz: 0, calibrated: false, calibrationProgress: null };

  constructor(private binary: string, private publish: (message: LidarFrame | LidarStatus) => void) {}
  snapshot() { return { ...this.status }; }

  async connect(port: string) {
    await this.disconnect();
    if (!existsSync(this.binary)) throw new Error('Run npm run setup:lidar to build the SLAMTEC USB bridge.');
    this.tracker.reset();
    this.tracker.calibrate(true);
    this.lastFrameAt = 0;
    this.status = { kind: 'lidar-status', connected: false, streaming: false, port, message: 'Connecting C1 at 460800 baud…', frames: 0, points: 0, hz: 0, calibrated: false, calibrationProgress: null };
    this.publish(this.snapshot());
    const child = spawn(this.binary, [port], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    let errorText = '';
    child.stderr.on('data', chunk => { errorText = (errorText + String(chunk)).slice(-2000); });
    return new Promise<LidarStatus>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true; clearTimeout(timeout);
        if (error) reject(error); else resolve(this.snapshot());
      };
      const timeout = setTimeout(() => {
        errorText = 'C1 connection timed out. Check USB power and port.';
        child.stdin.end(); child.kill('SIGTERM');
        finish(new Error(errorText));
      }, 10000);
      const lines = createInterface({ input: child.stdout });
      lines.on('line', line => {
        if (this.child !== child || line.length > 500000 || !line.startsWith('{')) return;
        try {
          const message = JSON.parse(line);
          if (message.kind === 'device') {
            this.status = { ...this.status, connected: true, firmware: message.firmware, scanMode: message.scanMode, message: 'C1 ready — waiting for first scan' };
            this.publish(this.snapshot());
          } else if (message.kind === 'scan') {
            if (Math.abs(Date.now() - message.timestamp) > 1800 || !Array.isArray(message.samples)) return;
            const samples: PolarSample[] = message.samples.filter((sample: unknown) => Array.isArray(sample) && sample.length === 2 && sample.every(Number.isFinite) && sample[0] >= 0 && sample[0] < 360 && sample[1] > 0 && sample[1] <= 20);
            const now = Date.now();
            const elapsed = Math.max(1, now - this.lastFrameAt);
            const targets = this.tracker.update(samples, now);
            this.status = { ...this.status, connected: true, streaming: true, frames: message.frameNumber, points: samples.length, hz: this.lastFrameAt ? Math.round((this.status.hz ? this.status.hz * 0.8 + 1000 / elapsed * 0.2 : 1000 / elapsed) * 10) / 10 : 0, calibrated: this.tracker.calibrated, calibrationProgress: this.tracker.progress, calibrationMode: this.tracker.mode, ...this.tracker.diagnostics, message: this.tracker.progress !== null ? this.tracker.mode === 'automatic' ? 'Learning room automatically — move aside to reveal the background' : 'Calibrating — keep the room empty' : this.tracker.calibrated ? this.tracker.mode === 'automatic' ? 'C1 live — automatic object tracking' : 'C1 live — empty-room background calibrated' : 'C1 live — calibrate an empty room to track objects' };
            this.lastFrameAt = now;
            this.publish({ kind: 'lidar', frameNumber: message.frameNumber, timestamp: message.timestamp, receivedAt: now, points: samples.map(polarPoint), targets });
            if (message.frameNumber % 5 === 0 || !settled) this.publish(this.snapshot());
            finish();
          }
        } catch { /* Ignore malformed SDK output, never publish partial geometry. */ }
      });
      child.once('error', error => { errorText = error.message; finish(error); });
      child.once('close', () => {
        lines.close();
        if (this.child !== child) return;
        this.child = undefined;
        this.status = { ...this.status, connected: false, streaming: false, hz: 0, points: 0, calibrated: false, calibrationProgress: null, message: errorText.trim() || 'C1 disconnected' };
        this.publish(this.snapshot());
        finish(new Error(this.status.message));
      });
    });
  }

  calibrate() {
    if (!this.status.streaming || Date.now() - this.lastFrameAt > 1800) throw new Error('Connect C1 and wait for live scans first.');
    this.tracker.calibrate();
    this.status = { ...this.status, calibrated: false, calibrationProgress: 0, calibrationMode: 'empty-room', message: 'Calibrating — keep the room empty' };
    this.publish(this.snapshot());
    return this.snapshot();
  }

  async disconnect() {
    const child = this.child;
    if (child) await new Promise<void>(resolve => {
      const force = setTimeout(() => child.kill('SIGKILL'), 2500);
      child.once('close', () => { clearTimeout(force); resolve(); });
      child.stdin.end(); child.kill('SIGTERM');
    });
    this.tracker.reset();
    this.status = { ...this.status, connected: false, streaming: false, hz: 0, points: 0, calibrated: false, calibrationProgress: null, message: 'C1 disconnected' };
    this.publish(this.snapshot());
  }
}
