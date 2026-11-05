#!/usr/bin/env python3
"""USB-only Wi-Fi provisioning; credentials never enter command arguments or logs."""
import argparse
import getpass
import ipaddress
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import serial

parser = argparse.ArgumentParser()
parser.add_argument('--port', required=True)
parser.add_argument('--ssid', help='2.4 GHz network name. Asked in a prompt when omitted.')
parser.add_argument('--mac-dialog', action='store_true')
parser.add_argument('--config', default='.deps/firefly-device.json', help='Local pairing file for this device')
args = parser.parse_args()

def ask(prompt, hidden=False):
    if args.mac_dialog:
        script = 'text returned of (display dialog ' + json.dumps(prompt) + ' default answer ""' + (' with hidden answer' if hidden else '') + ' buttons {"Cancel", "OK"} default button "OK" with title "Firefly Heartbeat")'
        result = subprocess.run(['osascript', '-e', script], capture_output=True, text=True)
        if result.returncode:
            raise SystemExit('Wi-Fi setup cancelled.')
        return result.stdout.rstrip('\n')
    return getpass.getpass(prompt + ' ') if hidden else input(prompt + ' ')

ssid = args.ssid if args.ssid is not None else ask('2.4 GHz Wi-Fi name for Firefly:')
password = ask('Wi-Fi password for Firefly. It is stored only on the device.', hidden=True)
if not 1 <= len(ssid.encode()) <= 32 or len(password.encode()) > 63:
    raise SystemExit('SSID/password too long for ESP32 Wi-Fi.')
config_path = Path(args.config)
key = secrets.token_hex(16)
# Save pairing key before transmission so a timeout is recoverable without re-pairing.
config_path.parent.mkdir(parents=True, exist_ok=True)
fd = os.open(config_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
os.fchmod(fd, 0o600)
with os.fdopen(fd, 'w') as f:
    json.dump({'host': '', 'key': key}, f)
payload = (json.dumps({'ssid': ssid, 'password': password, 'key': key})+'\n').encode()
acknowledged = False
with serial.Serial(args.port, 115200, timeout=0.5) as device:
    time.sleep(0.3)
    for attempt in range(3):
        device.write(payload)
        device.flush()
        until = time.monotonic() + 5
        while time.monotonic() < until:
            try:
                line = device.readline().decode(errors='replace')
            except serial.SerialException:
                break  # ESP may reset immediately after saving.
            if 'FIREFLY_CONFIGURED' in line:
                acknowledged = True
                break
        if acknowledged:
            break
payload = None
password = None
ssid = None
# USB may disappear temporarily during reset. Reopen until the station has an IP.
deadline = time.monotonic() + 90
while time.monotonic() < deadline:
    try:
        with serial.Serial(args.port, 115200, timeout=1) as device:
            device.write(b'STATUS\n')
            for _ in range(5):
                line = device.readline().decode(errors='replace').strip()
                if 'FIREFLY_IP=' not in line:
                    continue
                value = line.split('FIREFLY_IP=')[-1]
                try:
                    ipaddress.IPv4Address(value)
                except ValueError:
                    continue
                config_path.write_text(json.dumps({'host': value, 'key': key})+'\n')
                print(f'Firefly joined Wi-Fi at {value}. Pairing saved in {config_path}.')
                raise SystemExit(0)
    except (serial.SerialException, OSError):
        pass
    time.sleep(1)
raise SystemExit(f'No Wi-Fi address received. Check 2.4 GHz SSID/password and rerun setup. Pairing key remains in {config_path}.')
