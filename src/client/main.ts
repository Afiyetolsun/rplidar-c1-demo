import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { LidarFrame, LidarStatus } from '../shared';
import { STALE_MS } from '../shared';
import { demoFrame } from '../demo';
import { nearestContact, proximityBeepInterval } from '../proximity';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/dm-mono/400.css';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<main>
  <header><h1><span class="sensor-logo" aria-hidden="true"></span>RPLIDAR<span class="accent"> / </span>C1</h1><span>PROXIMITY EXPERIMENT</span></header>
  <div class="instrument">
    <section class="scan-side" aria-label="LiDAR visualization">
      <div class="scan-heading"><h2>SCAN VIEW</h2><span id="source">DEMO / SYNTHETIC SCENE</span></div>
      <div class="stage" id="stage">
        <div id="viewport"></div>
        <span class="stage-label" id="sceneLabel">PROCEDURAL ROOM · NO RECORDED DATA</span>
        <button id="exitClean" hidden>EXIT CLEAN FRAME · ESC</button>
        <div class="scan-caption"><span id="bearing">000° · ID 01</span><span id="scanDistance">4.80 m</span></div>
      </div>
      <div class="scene-controls"><button id="topView" aria-pressed="false">TOP VIEW</button><button id="resetView">RESET VIEW</button><button id="cleanFrame">CLEAN FRAME</button><label>RADIUS <select id="radius"><option value="3">3 m</option><option value="6" selected>6 m</option><option value="12">12 m</option></select></label></div>
      <p class="scan-note" id="scanNote">Drag to orbit · scroll to zoom · sweep is a visual effect.</p>
    </section>
    <section class="readout" aria-label="Proximity and connection controls">
      <div class="readout-title"><h2>LIVE PROXIMITY</h2><span id="signal">DEMO SIGNAL</span></div>
      <div class="distance-block"><span>NEAREST CONTACT <span id="contactId">/ 01</span></span><div class="distance"><span id="distance">4.80</span><small>m</small></div><strong id="zone">DISTANT / SLOW PULSE</strong></div>
      <div class="telemetry"><div><span>CONTACTS</span><strong id="contacts">1</strong></div><div><span>PULSE RATE</span><strong id="pulseRate">0.6 Hz</strong></div><div><span>SCAN RATE</span><strong id="scanRate">SIMULATED</strong></div></div>
      <div class="mode-switch" role="group" aria-label="Signal source"><button id="demoMode" class="selected" aria-pressed="true">DEMO</button><button id="liveMode" aria-pressed="false">LIVE C1</button></div>
      <div id="demoControls"><div class="control-heading"><label for="range">DISTANCE TO SENSOR</label><output id="rangeOutput" for="range">4.80 m</output></div><input id="range" type="range" min="0.5" max="6" step="0.01" value="4.8"><button class="wide" id="approach">PLAY APPROACH · 12 SEC</button><p>Artificial room and contact, generated in code. Try the distance slider or play an approach.</p></div>
      <div id="liveControls" hidden><label class="port-label" for="port">C1 USB PORT</label><select id="port"><option value="">SELECT USB PORT</option></select><div class="connection-buttons"><button id="refreshPorts">REFRESH PORTS</button><button id="connect" class="primary" disabled>CONNECT C1</button></div><button id="calibrate" class="wide" disabled>RECALIBRATE EMPTY ROOM</button><p id="deviceStatus" role="status">Connect the C1 with its USB adapter. Keep the sensor level and still.</p><p>C1 scans one plane. Move aside during background learning, then walk toward it to confirm a contact.</p></div>
      <div class="sound-controls"><button id="sound" class="wide" aria-pressed="false">ENABLE SOUND</button><div class="volume-row"><label for="volume">VOLUME</label><input id="volume" type="range" min="5" max="100" step="5" value="35"><button id="testSound">TEST BEEP</button></div><p id="soundStatus" role="status">Tap to allow sound. Closer contacts produce faster beeps.</p></div>
    </section>
  </div>
  <footer><span>SLAMTEC RPLIDAR C1 · LOCAL USB</span><span>BY ALEX · <a href="https://www.moonscape.party/" target="_blank" rel="noopener noreferrer">LAGODISH TECH</a></span><span id="frameCount">FRAME 000000</span></footer>
</main>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const viewport = el('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#050d12');
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.domElement.setAttribute('aria-label', 'LiDAR scan: gray synthetic room, green scan returns, red confirmed contacts');
viewport.append(renderer.domElement);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.maxDistance = 35;
orbit.minDistance = 2;
orbit.maxPolarAngle = Math.PI / 2;
let topView = false;
function resetCamera() { camera.position.set(6.5, 7.5, 8.5); orbit.target.set(0, 0, 0); topView = false; el('topView').setAttribute('aria-pressed', 'false'); orbit.update(); }
resetCamera();
const resize = new ResizeObserver(() => { camera.aspect = viewport.clientWidth / Math.max(1, viewport.clientHeight); camera.updateProjectionMatrix(); renderer.setSize(viewport.clientWidth, viewport.clientHeight); });
resize.observe(viewport);
const scale = new THREE.Group(); scene.add(scale);
function rebuildScale() {
  while (scale.children.length) {
    const item = scale.children[0] as THREE.Line;
    scale.remove(item); item.geometry.dispose(); (item.material as THREE.Material).dispose();
  }
  const radius = Number(el<HTMLSelectElement>('radius').value);
  for (let r = radius / 6; r <= radius; r += radius / 6) {
    const points = Array.from({ length: 181 }, (_, i) => new THREE.Vector3(Math.sin(i * Math.PI / 90) * r, -0.02, Math.cos(i * Math.PI / 90) * r));
    scale.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#365645' })));
  }
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    scale.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(Math.sin(a) * radius, 0, Math.cos(a) * radius)]), new THREE.LineBasicMaterial({ color: '#233d32' })));
  }
}
rebuildScale();
const syntheticRoom = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: '#82958e', size: 0.024 }));
const roomPositions: number[] = [];
for (let height = 0; height <= 2.5; height += 0.1) {
  for (let x = -4.5; x <= 4.5; x += 0.08) for (const y of [-7, 7]) roomPositions.push(x, height - 1, -y);
  for (let y = -7; y <= 7; y += 0.08) for (const x of [-4.5, 4.5]) roomPositions.push(x, height - 1, -y);
}
syntheticRoom.geometry.setAttribute('position', new THREE.Float32BufferAttribute(roomPositions, 3));
scene.add(syntheticRoom);
const scan = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: '#b6ff63', size: 0.055 })); scene.add(scan);
const contacts = new THREE.Group(); scene.add(contacts);
const trails = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#fa6768', transparent: true, opacity: 0.65 })); scene.add(trails);
const sensor = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 24), new THREE.MeshBasicMaterial({ color: '#b6ff63' })); scene.add(sensor);
const sweep = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0.03, -6)]), new THREE.LineBasicMaterial({ color: '#b6ff63', transparent: true, opacity: 0.6 })); scene.add(sweep);
const histories = new Map<number, THREE.Vector3[]>();
let mode: 'demo' | 'live' = 'demo';
let frame: LidarFrame | undefined;
let status: LidarStatus | undefined;
let connectedToServer = false;
let requestPending = false;
let distance = 4.8;
let playingAt: number | undefined;
let demoNumber = 0;
let lastDemoAt = 0;
let lastReadoutAt = 0;
let staleCleared = false;
let audio: AudioContext | undefined;
let soundWanted = readPreference('sound') === 'true';
let soundOn = false;
let lastBeepAt = 0;
const activeOscillators = new Set<OscillatorNode>();
function readPreference(key: string) { try { return localStorage.getItem(`c1-demo-${key}`); } catch { return null; } }
function savePreference(key: string, value: string) { try { localStorage.setItem(`c1-demo-${key}`, value); } catch { /* Private browsing can disable storage. */ } }
const savedVolume = Number(readPreference('volume'));
if (Number.isFinite(savedVolume) && savedVolume >= 5 && savedVolume <= 100) el<HTMLInputElement>('volume').value = String(savedVolume);
function stopAudio() { for (const oscillator of activeOscillators) { try { oscillator.stop(); } catch { /* Already stopped. */ } } activeOscillators.clear(); }
function clearGeometry() { scan.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3)); histories.clear(); trails.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3)); clearContacts(); }
function clearContacts() { for (const child of [...contacts.children]) { const mesh = child as THREE.Mesh; mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); contacts.remove(mesh); } }
function receiveFrame(next: LidarFrame) {
  frame = next; staleCleared = false;
  scan.geometry.setAttribute('position', new THREE.Float32BufferAttribute(next.points.flatMap(([x, y, z]) => [x, z, -y]), 3));
  scan.geometry.computeBoundingSphere();
  clearContacts();
  const ids = new Set(next.targets.map(t => t.id));
  for (const id of histories.keys()) if (!ids.has(id)) histories.delete(id);
  for (const target of next.targets) {
    const position = new THREE.Vector3(target.x, 0.07, -target.y);
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshBasicMaterial({ color: '#ff6168' }));
    marker.position.copy(position); contacts.add(marker);
    const history = histories.get(target.id) ?? []; history.push(position); if (history.length > 35) history.shift(); histories.set(target.id, history);
  }
  const positions: number[] = [];
  for (const history of histories.values()) for (let i = 1; i < history.length; i++) positions.push(...history[i - 1].toArray(), ...history[i].toArray());
  trails.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); trails.geometry.computeBoundingSphere();
}
function updateControls() {
  el<HTMLButtonElement>('connect').disabled = requestPending || !connectedToServer || (!status?.connected && !el<HTMLSelectElement>('port').value);
  el('connect').textContent = requestPending ? 'PLEASE WAIT…' : status?.connected ? 'DISCONNECT C1' : 'CONNECT C1';
  el<HTMLSelectElement>('port').disabled = requestPending || Boolean(status?.connected);
  el<HTMLButtonElement>('refreshPorts').disabled = requestPending;
  el<HTMLButtonElement>('calibrate').disabled = requestPending || !status?.streaming || status?.calibrationProgress != null || !frame || Date.now() - frame.timestamp > STALE_MS;
  el('calibrate').textContent = status?.calibrationProgress != null ? `LEARNING ${Math.round(status.calibrationProgress * 100)}%` : 'RECALIBRATE EMPTY ROOM';
}
function updateReadout() {
  const target = nearestContact(frame, Date.now());
  el('distance').textContent = target ? target.distance.toFixed(2) : '—';
  el('scanDistance').textContent = target ? `${target.distance.toFixed(2)} m` : 'NO CONTACT';
  el('contactId').textContent = target ? `/ ${String(target.id).padStart(2, '0')}` : '';
  el('contacts').textContent = target ? String(frame!.targets.length) : '0';
  el('pulseRate').textContent = target ? `${(1000 / proximityBeepInterval(target.distance)).toFixed(1)} Hz` : '—';
  el('zone').textContent = !target ? 'NO CONFIRMED CONTACT' : target.distance < 1.5 ? 'NEAR / RAPID PULSE' : target.distance < 3 ? 'PULSE ACCELERATING' : 'DISTANT / SLOW PULSE';
  el('zone').classList.toggle('near', Boolean(target && target.distance < 1.5));
  el('bearing').textContent = target ? `${String(Math.round((Math.atan2(target.x, target.y) * 180 / Math.PI + 360) % 360)).padStart(3, '0')}° · ID ${target.id}` : 'WAITING FOR CONTACT';
  const fresh = frame && Date.now() - frame.timestamp <= STALE_MS;
  el('signal').textContent = mode === 'demo' ? 'DEMO SIGNAL' : fresh ? 'LIVE SIGNAL' : 'NO FRESH SCANS';
  el('scanRate').textContent = mode === 'demo' ? 'SIMULATED' : fresh ? `${status?.hz.toFixed(1) ?? '—'} Hz` : '—';
  el('frameCount').textContent = `FRAME ${String(frame?.frameNumber ?? 0).padStart(6, '0')}`;
  updateControls();
}
function setMode(next: 'demo' | 'live') {
  mode = next; playingAt = undefined; frame = undefined; stopAudio(); clearGeometry();
  syntheticRoom.visible = next === 'demo';
  el('demoControls').hidden = next !== 'demo'; el('liveControls').hidden = next !== 'live';
  for (const name of ['demo', 'live']) { el(`${name}Mode`).classList.toggle('selected', name === next); el(`${name}Mode`).setAttribute('aria-pressed', String(name === next)); }
  el('source').textContent = next === 'demo' ? 'DEMO / SYNTHETIC SCENE' : 'LIVE / RPLIDAR C1';
  el('sceneLabel').textContent = next === 'demo' ? 'PROCEDURAL ROOM · NO RECORDED DATA' : 'LIVE 2D SCAN · SENSOR ORIGIN';
  el('approach').textContent = 'PLAY APPROACH · 12 SEC';
  lastDemoAt = 0; updateReadout(); if (next === 'live') void refreshPorts();
}
async function refreshPorts() {
  try {
    const response = await fetch('/api/ports'); const ports = await response.json(); if (!response.ok) throw new Error(ports.error);
    const select = el<HTMLSelectElement>('port'), selected = select.value || status?.port;
    select.replaceChildren(new Option(ports.length ? 'SELECT USB PORT' : 'NO PORTS · CONNECT USB AND REFRESH', ''));
    for (const port of ports) select.add(new Option(`${port.path}${port.manufacturer ? ` · ${port.manufacturer}` : ''}`, port.path));
    if ([...select.options].some(option => option.value === selected)) select.value = selected!;
    else if (ports.length === 1) select.value = ports[0].path;
  } catch (error) { el('deviceStatus').textContent = `Cannot list ports: ${String(error)}. Start the local server and refresh.`; }
  updateControls();
}
async function action(name: 'connect' | 'disconnect' | 'calibrate') {
  if (requestPending) return;
  requestPending = true; updateControls();
  if (name !== 'connect') { frame = undefined; clearGeometry(); stopAudio(); }
  try {
    const response = await fetch(`/api/lidar/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port: el<HTMLSelectElement>('port').value }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    status = result; el('deviceStatus').textContent = status!.message;
  } catch (error) { el('deviceStatus').textContent = error instanceof Error ? error.message : String(error); }
  finally { requestPending = false; updateControls(); }
}
let socket: WebSocket;
function openSocket() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket.onopen = () => { connectedToServer = true; updateControls(); };
  socket.onmessage = event => {
    const message = JSON.parse(event.data) as LidarFrame | LidarStatus;
    if (message.kind === 'lidar' && mode === 'live' && Math.abs(Date.now() - message.timestamp) <= STALE_MS) receiveFrame(message);
    if (message.kind === 'lidar-status') {
      status = message; el('deviceStatus').textContent = message.message;
      if (mode === 'live' && !message.streaming) { frame = undefined; clearGeometry(); stopAudio(); }
      updateControls();
    }
  };
  socket.onclose = () => { connectedToServer = false; if (mode === 'live') { frame = undefined; clearGeometry(); stopAudio(); } el('deviceStatus').textContent = 'Local server disconnected. Reconnecting…'; updateControls(); window.setTimeout(openSocket, 2000); };
}
openSocket();
function updateSound() {
  soundOn = soundWanted && audio?.state === 'running';
  el('sound').textContent = soundOn ? 'MUTE SOUND' : soundWanted ? 'RESUME SOUND' : 'ENABLE SOUND';
  el('sound').setAttribute('aria-pressed', String(soundOn));
  el('soundStatus').textContent = soundOn ? 'Sound on · follows the nearest confirmed contact.' : soundWanted ? 'Tap RESUME SOUND to unlock browser audio.' : 'Tap to allow sound. Closer contacts produce faster beeps.';
}
async function enableSound() {
  try {
    audio ??= new AudioContext();
    audio.onstatechange = updateSound;
    await Promise.race([audio.resume(), new Promise((_, reject) => window.setTimeout(() => reject(new Error('Audio blocked')), 2500))]);
    if (audio.state !== 'running') throw new Error('Audio blocked');
    soundWanted = true; savePreference('sound', 'true'); lastBeepAt = 0; updateSound(); return true;
  } catch { el('soundStatus').textContent = 'Allow audio for this tab, then press TEST BEEP again.'; return false; }
}
function beep(distance: number, offset = 0, duration = 0.18) {
  if (!audio || audio.state !== 'running') return;
  const now = audio.currentTime + offset;
  const proximity = Math.max(0, Math.min(1, (6 - distance) / 5.5));
  const oscillator = audio.createOscillator(), gain = audio.createGain();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(510 + proximity * 440, now);
  oscillator.frequency.exponentialRampToValueAtTime(395 + proximity * 320, now + duration * 0.75);
  const volume = 0.5 * Math.pow(el<HTMLInputElement>('volume').valueAsNumber / 100, 0.7);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
  gain.gain.setValueAtTime(volume, now + duration - 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain).connect(audio.destination); activeOscillators.add(oscillator);
  oscillator.onended = () => { activeOscillators.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
  oscillator.start(now); oscillator.stop(now + duration + 0.01);
}
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function animate(now: number) {
  requestAnimationFrame(animate);
  if (mode === 'demo' && now - lastDemoAt >= 100) {
    if (playingAt !== undefined) {
      const progress = Math.min(1, (now - playingAt) / 12000);
      distance = 4.8 - 4.15 * (0.5 - 0.5 * Math.cos(progress * Math.PI * 2));
      el<HTMLInputElement>('range').value = distance.toFixed(2);
      if (progress >= 1) { playingAt = undefined; el('approach').textContent = 'PLAY APPROACH · 12 SEC'; }
    }
    el('rangeOutput').textContent = `${distance.toFixed(2)} m`;
    receiveFrame(demoFrame(distance, ++demoNumber, Date.now())); lastDemoAt = now;
  }
  if (mode === 'live' && frame && Date.now() - frame.timestamp > STALE_MS && !staleCleared) { clearGeometry(); stopAudio(); staleCleared = true; }
  const target = nearestContact(frame, Date.now());
  if (soundOn && document.visibilityState === 'visible' && target && now - lastBeepAt >= proximityBeepInterval(target.distance)) { beep(target.distance); lastBeepAt = now; }
  if (now - lastReadoutAt >= 100) { updateReadout(); lastReadoutAt = now; }
  sweep.rotation.y = reducedMotion ? 0 : -now / 2000;
  sweep.scale.setScalar(Number(el<HTMLSelectElement>('radius').value) / 6);
  orbit.update(); renderer.render(scene, camera);
}
requestAnimationFrame(animate);
el('demoMode').onclick = () => setMode('demo'); el('liveMode').onclick = () => setMode('live');
el('refreshPorts').onclick = () => void refreshPorts(); el('port').onchange = updateControls;
el('connect').onclick = () => void action(status?.connected ? 'disconnect' : 'connect');
el('calibrate').onclick = () => void action('calibrate');
el('range').oninput = () => { distance = el<HTMLInputElement>('range').valueAsNumber; playingAt = undefined; el('approach').textContent = 'PLAY APPROACH · 12 SEC'; };
el('approach').onclick = () => { playingAt = playingAt === undefined ? performance.now() : undefined; el('approach').textContent = playingAt === undefined ? 'PLAY APPROACH · 12 SEC' : 'STOP APPROACH'; };
el('sound').onclick = () => { if (soundOn) { soundWanted = false; savePreference('sound', 'false'); stopAudio(); updateSound(); } else void enableSound(); };
el('testSound').onclick = async () => { if (await enableSound()) { stopAudio(); for (let i = 0; i < 3; i++) beep(2, i * 0.5, 0.3); lastBeepAt = performance.now() + 1500; } };
el('volume').oninput = () => savePreference('volume', el<HTMLInputElement>('volume').value);
el('radius').onchange = rebuildScale;
el('resetView').onclick = resetCamera;
el('topView').onclick = () => { topView = !topView; if (topView) { camera.position.set(0, 16, 0.001); orbit.target.set(0, 0, 0); orbit.update(); el('topView').setAttribute('aria-pressed', 'true'); } else resetCamera(); };
function cleanFrame(enabled: boolean) { document.body.classList.toggle('clean', enabled); el('exitClean').hidden = !enabled; }
el('cleanFrame').onclick = () => cleanFrame(true); el('exitClean').onclick = () => cleanFrame(false);
document.addEventListener('keydown', event => { if (event.key === 'Escape') cleanFrame(false); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') stopAudio(); });
updateSound();
