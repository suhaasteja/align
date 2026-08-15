// Vizio SmartCast.
//
// HTTPS with a self-signed cert on 7345 (newer sets) or 9000 (older). Pairing is
// a real two-step challenge: ask the TV to start pairing, it shows a 4-digit PIN
// on screen, you send the PIN back and get a long-lived auth token.
//
// Keys are (codeset, code) pairs rather than names. The tables below are the
// commonly documented SmartCast codesets.

import { httpJson } from '../http.js';
import { saveDevice } from '../store.js';
import { randomUUID } from 'node:crypto';

export const brand = 'vizio';
export const label = 'Vizio SmartCast';
export const needsPairing = true;
export const pairingKind = 'pin'; // TV displays a code, user types it in
const PORTS = [7345, 9000];

const MAP = {
  power: [11, 2], power_on: [11, 1], power_off: [11, 0],
  volume_down: [5, 0], volume_up: [5, 1], mute: [5, 4],
  channel_down: [8, 0], channel_up: [8, 1], previous: [8, 2],
  down: [3, 0], left: [3, 1], ok: [3, 3], back: [3, 4],
  right: [3, 7], up: [3, 8], exit: [3, 9], menu: [3, 6], info: [3, 6],
  input: [7, 1],
  play: [2, 3], pause: [2, 2], play_pause: [2, 3],
};

function base(device) {
  return `https://${device.ip}:${device.port || 7345}`;
}

function headers(device) {
  const h = { 'Content-Type': 'application/json' };
  if (device.authToken) h.AUTH = device.authToken;
  return h;
}

export async function probe(ip, { timeout = 1500 } = {}) {
  for (const port of PORTS) {
    try {
      // Unauthenticated, but a Vizio always answers with its STATUS envelope —
      // which is enough to fingerprint it without starting a pairing session.
      const res = await httpJson(`https://${ip}:${port}/state/device/deviceinfo`, { timeout, insecure: true })
        .catch((err) => err.body);
      if (!res || typeof res !== 'object' || !('STATUS' in res)) continue;
      return {
        brand,
        ip,
        port,
        name: res?.ITEMS?.[0]?.VALUE?.NAME || 'Vizio SmartCast TV',
        needsPairing: true,
      };
    } catch {
      // try the next port
    }
  }
  return null;
}

// Step 1 of 2 — makes the TV display a PIN.
export async function startPairing(device) {
  const deviceId = device.pairDeviceId || randomUUID();
  const res = await httpJson(`${base(device)}/pairing/start`, {
    method: 'PUT',
    insecure: true,
    timeout: 8000,
    headers: headers(device),
    body: JSON.stringify({ DEVICE_ID: deviceId, DEVICE_NAME: 'Phone Remote' }),
  });
  const token = res?.ITEM?.PAIRING_REQ_TOKEN;
  if (token === undefined) throw new Error(`Vizio refused to start pairing: ${res?.STATUS?.DETAIL || 'unknown error'}`);
  device.pairDeviceId = deviceId;
  device.pairToken = token;
  saveDevice(device);
  return { ok: true, needsPin: true, message: 'Enter the PIN shown on the TV.' };
}

// Step 2 of 2 — exchange the on-screen PIN for a permanent auth token.
export async function pair(device, { pin } = {}) {
  if (!pin) return startPairing(device);
  if (device.pairToken === undefined) await startPairing(device);

  const res = await httpJson(`${base(device)}/pairing/pair`, {
    method: 'PUT',
    insecure: true,
    timeout: 8000,
    headers: headers(device),
    body: JSON.stringify({
      DEVICE_ID: device.pairDeviceId,
      CHALLENGE_TYPE: 1,
      RESPONSE_VALUE: String(pin).trim(),
      PAIRING_REQ_TOKEN: device.pairToken,
    }),
  });

  const auth = res?.ITEM?.AUTH_TOKEN;
  if (!auth) throw new Error(`Pairing failed: ${res?.STATUS?.DETAIL || 'wrong PIN?'}`);
  device.authToken = auth;
  delete device.pairToken;
  saveDevice(device);
  return { ok: true, message: 'Paired with the TV.' };
}

// Deliberately absent: `home`. SmartCast has no HOME in the documented nav
// codeset, and codesets are sparse enough that guessing a code can land on a
// service menu. Use `input` to reach the SmartCast hub instead.
export const supportedKeys = Object.keys(MAP);

export async function sendKey(device, key) {
  const entry = MAP[key];
  if (!entry) throw new Error(`Vizio has no mapping for "${key}"`);
  if (!device.authToken) throw new Error('not paired yet');
  const [codeset, code] = entry;

  const res = await httpJson(`${base(device)}/key_command/`, {
    method: 'PUT',
    insecure: true,
    timeout: 5000,
    headers: headers(device),
    body: JSON.stringify({ KEYLIST: [{ CODESET: codeset, CODE: code, ACTION: 'KEYPRESS' }] }),
  });
  if (res?.STATUS?.RESULT && res.STATUS.RESULT.toUpperCase() !== 'SUCCESS') {
    throw new Error(`Vizio rejected the key: ${res.STATUS.DETAIL || res.STATUS.RESULT}`);
  }
}

export const features = {};
