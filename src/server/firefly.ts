import dgram from 'node:dgram';
import { randomBytes } from 'node:crypto';
import type { LidarFrame, LidarStatus } from '../shared.js';
import { STALE_MS } from '../shared.js';

export const FIREFLY_PACKET_SIZE = 212;
/** Little endian, metres -> millimetres; no room data is stored. */
export function encodeFirefly(key: Buffer, session: number, sequence: number, status: LidarStatus | undefined, frame: LidarFrame | undefined, now = Date.now()) {
  if (key.length !== 16) throw new Error('Firefly key must contain 16 bytes.');
  const packet = Buffer.alloc(FIREFLY_PACKET_SIZE);
  packet.write('FFH1'); key.copy(packet, 4);
  packet.writeUInt32LE(session, 20); packet.writeUInt32LE(sequence >>> 0, 24);
  const fresh = !!(status?.connected && status.streaming && frame && now - frame.receivedAt >= 0 && now - frame.receivedAt < STALE_MS);
  packet[28] = fresh ? (status?.calibrated ? 2 : 1) : 0;
  packet[30] = Math.round(Math.max(0, Math.min(1, status?.calibrationProgress ?? 0)) * 100);
  packet.writeUInt16LE(65535, 32);
  if (!fresh || !frame) return packet;
  const targets = status?.calibrated ? frame.targets.filter(t => Number.isFinite(t.x) && Number.isFinite(t.y) && Math.hypot(t.x, t.y) <= 20).sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y)).slice(0, 8) : [];
  packet[29] = targets.length;
  if (targets.length) packet.writeUInt16LE(Math.round(Math.hypot(targets[0].x, targets[0].y) * 1000), 32);
  for (const [x, y] of frame.points) {
    const distance = Math.hypot(x, y);
    if (!Number.isFinite(distance) || distance <= 0 || distance > 20) continue;
    const bin = Math.floor(((Math.atan2(x, y) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 72);
    const mm = Math.max(1, Math.round(distance * 1000));
    const offset = 36 + bin * 2;
    if (!packet.readUInt16LE(offset) || mm < packet.readUInt16LE(offset)) packet.writeUInt16LE(mm, offset);
  }
  targets.forEach((t, i) => { packet.writeInt16LE(Math.round(t.x * 1000), 180 + i * 4); packet.writeInt16LE(Math.round(t.y * 1000), 182 + i * 4); });
  return packet;
}

export class FireflySender {
  private socket = dgram.createSocket('udp4');
  private session = randomBytes(4).readUInt32LE();
  private sequence = 0;
  private frame?: LidarFrame;
  private status?: LidarStatus;
  private timer: NodeJS.Timeout;
  constructor(private host: string, private key: Buffer) {
    this.socket.on('error', error => console.error(`Firefly UDP: ${error.message}`));
    this.timer = setInterval(() => this.socket.send(encodeFirefly(this.key, this.session, this.sequence++, this.status, this.frame), 8789, this.host), 100);
  }
  update(message: LidarFrame | LidarStatus) {
    if (message.kind === 'lidar') this.frame = message;
    else { this.status = message; if (!message.connected || !message.streaming) this.frame = undefined; }
  }
  close() { clearInterval(this.timer); this.socket.close(); }
}

/** A single-device file remains compatible; arrays enable simultaneous displays. */
export function parseFireflyDevices(config: unknown): { host: string; key: string }[] {
  if (config === undefined) return [];
  const devices = Array.isArray(config) ? config : [config];
  if (!devices.every(device => device && typeof device.host === 'string' && device.host.trim().length > 0 && typeof device.key === 'string' && /^[a-f0-9]{32}$/i.test(device.key))) {
    throw new Error('Invalid Firefly config: each device needs a host and a 32-digit hexadecimal key.');
  }
  return devices.map(device => ({ host: device.host, key: device.key }));
}
