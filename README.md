# RPLIDAR C1 Proximity Demo

A local browser demo for the **SLAMTEC RPLIDAR C1**: see a live 360° scan, follow moving objects, and hear beeps speed up as the nearest confirmed contact approaches. It includes an interactive synthetic demo, so you can try the interface without a sensor.

Created by **Alex**, founder of [Lagodish Tech](https://www.moonscape.party/).

The dark scan view, red contact trails, green visual sweep, and proximity sound come from the original experiment. This standalone version supports **C1 only**. It contains no room recordings, personal point clouds, camera imagery, or recorded sensor sessions.

[Hardware specifications](https://www.slamtec.com/en/c1/spec) · [SLAMTEC support and manuals](https://www.slamtec.com/en/support)

## Try it without hardware

Install **Node.js 22.12 or newer** and npm, then run from this folder:

```bash
npm ci
npm run dev
```

Open **http://127.0.0.1:5174**. The initial **DEMO** mode uses a rectangle and a circular contact generated in code; the gray 3D walls are illustrative. Drag the distance slider or press **PLAY APPROACH**. Press **ENABLE SOUND** once to unlock browser audio. **TEST BEEP** plays three audible pulses; **VOLUME** controls their level.

No SDK, serial adapter, or hardware is needed for DEMO. Drag to orbit the scene, scroll to zoom, or choose **TOP VIEW**. **CLEAN FRAME** hides the controls for screen recording; press Esc to exit.

## Supported hardware

- **SLAMTEC RPLIDAR C1**, with its USB serial adapter and a data-capable USB cable. Use the adapter/cabling specified by SLAMTEC for the C1 development kit.
- One serial connection at **460800 baud**, decoded by the official [SLAMTEC C++ SDK](https://github.com/Slamtec/rplidar_sdk).
- This application's bridge setup supports **macOS and Linux**. Native Windows is not supported by the supplied POSIX setup script and bridge, even though the upstream SDK supports Windows.
- Other RPLIDAR models, TI mmWave radars, cameras, and external LiDAR frame adapters are outside this project's scope.

C1 is a **2D** sensor. The live view shows a horizontal scan plane in a 3D viewer; it does not reconstruct a volumetric room. Gray synthetic walls appear only in DEMO. In LIVE C1, the geometry comes only from current sensor returns. The rotating green sweep is a visual effect, not a measurement of scan timing.

## Connect a real C1

### 1. Install build tools

On macOS, install Xcode Command Line Tools if needed:

```bash
xcode-select --install
```

On Debian/Ubuntu:

```bash
sudo apt-get install build-essential git
```

Install Node.js separately if needed. You also need Git and make. If the USB adapter does not appear as a serial port, consult the [SLAMTEC C1 manual and driver instructions](https://www.slamtec.com/en/support) for your adapter and OS.

### 2. Build the bridge

```bash
npm ci
npm run setup:lidar
```

The setup script downloads the official SDK at commit `99478e5fb90de3b4a6db0080acacd373f8b36869`, compiles its static library, and builds `.deps/lidar/rplidar-bridge`. It copies the SDK license beside the binary. `.deps/` stays outside Git and the source release archive. Setup needs network access; subsequent runs use the local bridge.

An existing SDK checkout can be supplied explicitly:

```bash
RPLIDAR_SDK_DIR=/path/to/rplidar_sdk npm run setup:lidar
```

This override uses your checkout as-is; the revision pin applies to checkouts downloaded by the script.

### 3. Connect and scan

1. Connect C1 through its USB adapter. Place it securely, level and stationary, with its scan plane crossing the body of a person who approaches. Do not obstruct the rotating sensor.
2. Run `npm run dev`, open http://127.0.0.1:5174, and choose **LIVE C1**.
3. Press **REFRESH PORTS**, select the C1 port, and press **CONNECT C1**. macOS typically uses `/dev/cu.usbserial-…`; Linux typically uses `/dev/ttyUSB0`. The list includes available serial ports, so choose your C1 adapter carefully.
4. During automatic background learning, move aside so the sensor can see surfaces behind you. Learning takes 40 scans (about four seconds at 10 Hz).
5. Walk toward the sensor. A consistent moving cluster becomes a red contact and drives the distance display and sound. Press **ENABLE SOUND** or **RESUME SOUND** if necessary.
6. For a cleaner background, clear people from the scan plane and press **RECALIBRATE EMPTY ROOM**. This captures 24 scans and keeps that background fixed. Recalibrate after moving the sensor or rearranging the room.
7. Press **DISCONNECT C1** when finished. It stops scanning and requests motor stop. Stopping the Node server also requests motor stop. Closing the browser tab leaves the sensor running until disconnected or the server stops.

Linux serial permission errors may require adding your account to the device's serial-access group (commonly `dialout`), then logging out and back in:

```bash
sudo usermod -aG dialout "$USER"
```

Use the group appropriate to your distribution. Close RoboStudio, serial monitors, or other processes that own the same port before connecting.

## What a contact means

The tracker learns background distances in half-degree bins, looks for closer clusters, and requires a sustained motion trajectory before confirming a contact. Static walls and furniture do not directly trigger beeps. Motion is needed for initial confirmation; an already confirmed contact remains while the current scan still observes it, including after it stops. A missing contact is removed from the displayed frame.

This is **object tracking, not person recognition**. A moving object can trigger it; occlusion, reflective surfaces, sparse returns, or someone already standing in the calibration scene can prevent or distort detection. Distance is the horizontal distance to the nearest cluster centroid, not the nearest raw return or exact body boundary. This experiment is not a protective safety system.

The sound retains the original triangle-wave pitch envelope and pulse curve: approximately 0.59 Hz at 6 m and 5.88 Hz at 0.5 m, clamped beyond that range. Sound is generated locally with Web Audio; there are no audio recordings. If live frames stop, geometry and distance clear after 1.8 seconds and proximity beeps cease. Hidden tabs do not produce proximity beeps. Returning to a tab can require **RESUME SOUND**.

## Privacy and publication

- No real room assets are shipped, loaded automatically, or accepted through a file-upload interface.
- There is no capture/export endpoint, recording to disk, cloud service, analytics, remote font request, or remote scene fetch.
- Live frames, tracking history, and background calibration exist only in memory. Disconnect resets the background. Restarting or reconnecting requires learning again.
- Browser storage holds only sound preference and volume. It stores no points, room placement, USB path, or device serial number. The bridge and API omit hardware serial numbers.
- Both servers listen on `127.0.0.1`. The API and WebSocket reject foreign browser origins. Development uses port 5174 for the UI and 8788 for the API; production uses 8788 for both.
- Real scans, captures, logs, SDK downloads, dependencies, and build output are Git-ignored. Vite's public-directory copying is disabled.

Before publishing:

```bash
npm run check:privacy
npm run release
```

The release command runs tests, type checks, and a production build, checks an explicit source-file allowlist, and creates `release/rplidar-c1-demo-source.tar.gz` from that allowlist only. It includes no `.git` history, dependencies, native binaries, build output, or recordings. Publish this source folder or unpack that archive into a fresh GitHub repository; do not reuse the original experiment's repository history. The check catches unexpected source files and common private-data markers; review any files you add before sharing them.

## Production and development

```bash
npm run build
npm start
# Open http://127.0.0.1:8788
```

Run all commands from the project root so the server can find the compiled bridge. You need `setup:lidar` only for live hardware. No production hosting is needed: USB access happens on the computer running this server.

API smoke tests use an OS-assigned loopback port, so checks can run while the demo is open. For a different production port, use `C1_DEMO_PORT=8790 npm start` and open the printed URL. Keep the default API port 8788 with `npm run dev`, because Vite proxies to that port.

```bash
npm test                # Synthetic tracker and proximity tests; local API/WS smoke tests
npm run typecheck       # Client and server TypeScript
npm run check           # Tests, types, production build
npm run check:privacy   # Source allowlist and private-data marker check
npm run release         # Verified source archive for sharing
```

GitHub Actions runs the checks on Node.js 22. Hardware tests are deliberately separate from automated tests.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| No USB port | Check the data cable, adapter, driver and power; press REFRESH PORTS. |
| Bridge missing | Run `npm run setup:lidar` in this folder. |
| Connection timeout | Confirm the correct C1 port, USB power, and that another app is not using it. |
| No red contacts | Wait for learning, reveal the background, recalibrate an empty scene, then move coherently in the scan plane. |
| Scan disappeared | USB or scan stream became stale. Refresh ports and reconnect. |
| No sound | Press TEST BEEP, allow browser audio, and check tab mute and speaker volume. |
| Port already in use | Stop the other copy of this demo using 5174 or 8788. |

## Source layout

`src/client/` contains the viewer and Web Audio controls. `src/demo.ts` generates the synthetic scene's scan. `src/server/rplidar.ts` supervises the C++ bridge; `lidar-tracker.ts` learns background and confirms motion. `scripts/rplidar_bridge.cpp` uses SLAMTEC's SDK to decode C1 scans. `src/shared.ts` defines the local frame protocol (metres: X right, Y forward, Z up; C1 has Z = 0).

## Author and company

**Alex** is the author of this demo and the founder of [Lagodish Tech](https://www.moonscape.party/), a product engineering studio working on software, AI, and robotics.

Explore the company's projects and services at [moonscape.party](https://www.moonscape.party/).

## License

Application code is licensed under [MIT](LICENSE). The upstream SLAMTEC SDK is downloaded separately and keeps its own [BSD-style license](docs/SLAMTEC-SDK-LICENSE.txt). See [third-party notices](docs/THIRD_PARTY_NOTICES.md). This is an independent demo, not an official SLAMTEC application.
