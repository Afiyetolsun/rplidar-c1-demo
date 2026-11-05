import * as THREE from 'three';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

/** Optional local recording backdrop. It never changes sensor/tracker coordinates. */
export async function attachRoom(scene: THREE.Scene, renderer: THREE.WebGLRenderer, onVisibility: (shown: boolean, aligned: boolean) => void) {
  const panel = document.getElementById('roomControls')!;
  const message = document.getElementById('roomStatus')!;
  const toggle = document.getElementById('roomToggle') as HTMLButtonElement;
  let geometry: THREE.BufferGeometry | undefined;
  try {
    const info = await fetch('/api/room');
    if (!info.ok) return;
    const config = await info.json();
    if (!config.available) return;
    let aligned = Boolean(config.alignment);
    panel.hidden = false;
    message.textContent = 'Loading recorded room…';
    const response = await fetch('/api/room/cloud');
    if (!response.ok) throw new Error('Could not load the local scan.');
    geometry = new PLYLoader().parse(await response.arrayBuffer());
    const positions = geometry.getAttribute('position');
    if (!positions?.count) throw new Error('The scan has no points.');
    for (let i = 0; i < positions.count; i++) {
      if (![positions.getX(i), positions.getY(i), positions.getZ(i)].every(Number.isFinite)) throw new Error('Invalid scan coordinates.');
    }
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const center = box.getCenter(new THREE.Vector3());
    // Keep metre scale, Y-up; place the initial sensor at room centre, 1 m above floor.
    geometry.translate(-center.x, -box.min.y, -center.z);
    const clipping = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.15);
    const material = new THREE.PointsMaterial({ color: '#9eb8ad', size: 0.026, transparent: true, opacity: .55, depthWrite: false, clippingPlanes: [clipping] });
    const cloud = new THREE.Points(geometry, material);
    const root = new THREE.Group(); root.add(cloud); scene.add(root);
    renderer.localClippingEnabled = true;
    const input = (id: string) => document.getElementById(id) as HTMLInputElement;
    const update = () => {
      root.position.set(input('roomX').valueAsNumber || 0, -(input('roomHeight').valueAsNumber || 0), input('roomZ').valueAsNumber || 0);
      root.rotation.y = (input('roomYaw').valueAsNumber || 0) * Math.PI / 180;
      material.size = input('roomSize').valueAsNumber;
      material.opacity = input('roomOpacity').valueAsNumber;
      material.clippingPlanes = input('roomCut').checked ? [clipping] : [];
    };
    for (const control of panel.querySelectorAll('input')) control.addEventListener('input', () => {
      update();
      if (['roomX', 'roomZ', 'roomHeight', 'roomYaw'].includes(control.id)) {
        aligned = false; onVisibility(root.visible, false);
        message.textContent = 'Placement adjusted manually. Reload to restore the saved scan match.';
      }
    });
    toggle.disabled = false;
    toggle.onclick = () => {
      root.visible = !root.visible;
      toggle.textContent = root.visible ? 'POINT CLOUD ON' : 'POINT CLOUD OFF';
      toggle.setAttribute('aria-pressed', String(root.visible));
      onVisibility(root.visible, aligned);
    };
    document.getElementById('roomReset')!.onclick = () => {
      aligned = false; onVisibility(root.visible, false); message.textContent = 'Placement reset to room centre. Reload to restore the saved scan match.';
      input('roomX').value = '0'; input('roomZ').value = '0'; input('roomYaw').value = '0'; input('roomHeight').value = '1'; update();
    };
    if (config.alignment) {
      for (const [id, key] of [['roomX', 'x'], ['roomZ', 'z'], ['roomYaw', 'yaw'], ['roomHeight', 'height']]) input(id).value = String(config.alignment[key]);
    }
    update();
    toggle.textContent = 'POINT CLOUD ON'; toggle.setAttribute('aria-pressed', 'true');
    message.textContent = `${positions.count.toLocaleString()} recorded points · align the room with the live scan using placement controls. Initial placement is approximate.`;
    if (aligned) message.textContent = `SCAN MATCH · ${Math.round(config.alignment.overlap * 100)}% within 16 cm · fit ${(config.alignment.error * 100).toFixed(1)} cm (best 85% of returns). Saved placement; rematch after moving the sensor.`;
    onVisibility(true, aligned);
  } catch (error) {
    geometry?.dispose();
    panel.hidden = false; message.textContent = error instanceof Error ? error.message : 'Room scan unavailable.';
    toggle.disabled = true;
  }
}
