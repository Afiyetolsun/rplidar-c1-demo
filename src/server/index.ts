import express from 'express';
import { createServer, type IncomingMessage } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SerialPort } from 'serialport';
import { WebSocketServer, WebSocket } from 'ws';
import type { LidarFrame, LidarStatus } from '../shared.js';
import { RplidarC1 } from './rplidar.js';

const app = express();
app.disable('x-powered-by');
const server = createServer(app);
const port = Number(process.env.C1_DEMO_PORT ?? 8788);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('C1_DEMO_PORT must be an integer from 0 to 65535.');
const allowedHosts = new Set(['127.0.0.1:8788', 'localhost:8788', '127.0.0.1:5174', 'localhost:5174']);
const allowedOrigins = new Set([...allowedHosts].map(host => `http://${host}`));
app.use((request, response, next) => {
  if (!allowedHosts.has(request.headers.host ?? '') ||
      (request.headers.origin && !allowedOrigins.has(request.headers.origin))) {
    response.status(403).json({ error: 'Use the local dashboard on 127.0.0.1.' }); return;
  }
  response.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '8kb' }));
const sockets = new WebSocketServer({
  server, path: '/ws',
  verifyClient: ({ req, origin }: { req: IncomingMessage; origin: string }) => allowedHosts.has(req.headers.host ?? '') && (!origin || allowedOrigins.has(origin))
});
function broadcast(message: LidarFrame | LidarStatus) {
  const text = JSON.stringify(message);
  for (const client of sockets.clients) {
    if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 512000) client.send(text);
  }
}
const lidar = new RplidarC1(path.resolve('.deps/lidar/rplidar-bridge'), broadcast);
let busy = false;
app.get('/api/lidar/status', (_request, response) => response.json(lidar.snapshot()));
app.get('/api/ports', async (_request, response) => {
  try {
    const ports = await SerialPort.list();
    // Device serial numbers are unnecessary for connecting and are not exposed.
    response.json(ports.map(port => ({ path: outgoing(port.path), manufacturer: port.manufacturer })));
  } catch (error) { response.status(500).json({ error: messageOf(error) }); }
});
function outgoing(port: string) { return process.platform === 'darwin' ? port.replace(/^\/dev\/tty\./, '/dev/cu.') : port; }

app.post('/api/lidar/:action', async (request, response) => {
  if (!['connect', 'disconnect', 'calibrate'].includes(request.params.action)) {
    response.status(404).json({ error: 'Unknown C1 action.' }); return;
  }
  if (busy) { response.status(409).json({ error: 'C1 connection is changing. Please wait.' }); return; }
  busy = true;
  try {
    switch (request.params.action) {
      case 'connect': {
        const port: unknown = request.body?.port;
        if (typeof port !== 'string' || !(await SerialPort.list()).some(p => outgoing(p.path) === port)) {
          response.status(400).json({ error: 'Choose an available USB port, or refresh the port list.' }); return;
        }
        response.json(await lidar.connect(port)); break;
      }
      case 'disconnect': await lidar.disconnect(); response.json(lidar.snapshot()); break;
      case 'calibrate': response.json(lidar.calibrate()); break;
    }
  } catch (error) { response.status(400).json({ error: messageOf(error) }); }
  finally { busy = false; }
});
sockets.on('connection', socket => socket.send(JSON.stringify(lidar.snapshot())));
app.use(express.static(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client')));
app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  response.status(400).json({ error: messageOf(error) });
});
function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error); }
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') return;
  for (const host of [`127.0.0.1:${address.port}`, `localhost:${address.port}`]) {
    allowedHosts.add(host); allowedOrigins.add(`http://${host}`);
  }
  console.log(`RPLIDAR C1 Demo: http://127.0.0.1:${address.port} (dev UI: http://127.0.0.1:5174)`);
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const force = setTimeout(() => process.exit(1), 5000);
  await lidar.disconnect();
  for (const client of sockets.clients) client.close();
  sockets.close();
  server.close(() => { clearTimeout(force); process.exit(0); });
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
