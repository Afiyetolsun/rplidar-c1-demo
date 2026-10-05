/** Metres relative to the sensor: X right, Y forward, Z up. C1 measures Z=0. */
export interface LidarFrame {
  kind: 'lidar';
  frameNumber: number;
  timestamp: number;
  receivedAt: number;
  points: [number, number, number][];
  targets: { id: number; x: number; y: number; z: number }[];
}

export interface LidarStatus {
  kind: 'lidar-status';
  connected: boolean;
  streaming: boolean;
  port?: string;
  message: string;
  firmware?: string;
  scanMode?: string;
  frames: number;
  points: number;
  hz: number;
  calibrated: boolean;
  calibrationProgress: number | null;
  calibrationMode?: 'automatic' | 'empty-room';
  backgroundCoverage?: number;
  foregroundPoints?: number;
  clusters?: number;
}

export const STALE_MS = 1800;
