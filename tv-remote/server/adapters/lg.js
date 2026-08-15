// LG webOS TVs (2014+).
//
// Two sockets are involved, which is the awkward part of this brand:
//
//   1. The main SSAP socket (3001 TLS, or 3000 plain on older sets) handles
//      volume, power, apps, media transport. First connect triggers an on-screen
//      prompt; accepting returns a client-key we persist.
//   2. SSAP has no request for "press Up". Arrow keys and OK only exist on a
//      second "pointer input" socket whose URL you ask the first socket for.
//
// So a D-pad press means: main socket -> getPointerInputSocket -> pointer socket
// -> "type:button\nname:UP\n\n". We keep both alive per TV.

import { WebSocket } from 'ws';
import { saveDevice } from '../store.js';

export const brand = 'lg';
export const label = 'LG (webOS)';
export const needsPairing = true;
export const pairingKind = 'confirm';

const MANIFEST = {
  manifestVersion: 1,
  appVersion: '1.0',
  signed: {
    created: '20140509',
    appId: 'com.lge.test',
    vendorId: 'com.lge',
    localizedAppNames: { '': 'Phone Remote' },
    localizedVendorNames: { '': 'LG Electronics' },
    permissions: ['TEST_SECURE', 'CONTROL_INPUT_TEXT', 'CONTROL_MOUSE_AND_KEYBOARD', 'READ_INSTALLED_APPS', 'READ_LGE_SDX', 'READ_NOTIFICATIONS', 'SEARCH', 'WRITE_SETTINGS', 'WRITE_NOTIFICATION_ALERT', 'CONTROL_POWER', 'READ_CURRENT_CHANNEL', 'READ_RUNNING_APPS', 'READ_UPDATE_INFO', 'UPDATE_FROM_REMOTE_APP', 'READ_LGE_TV_INPUT_EVENTS', 'READ_TV_CURRENT_TIME'],
    serial: '2f930e2d2cfe083771f68e4fe7bb07',
  },
  permissions: ['LAUNCH', 'LAUNCH_WEBAPP', 'APP_TO_APP', 'CLOSE', 'TEST_OPEN', 'TEST_PROTECTED', 'CONTROL_AUDIO', 'CONTROL_DISPLAY', 'CONTROL_INPUT_JOYSTICK', 'CONTROL_INPUT_MEDIA_RECORDING', 'CONTROL_INPUT_MEDIA_PLAYBACK', 'CONTROL_INPUT_TV', 'CONTROL_POWER', 'READ_APP_STATUS', 'READ_CURRENT_CHANNEL', 'READ_INPUT_DEVICE_LIST', 'READ_NETWORK_STATE', 'READ_RUNNING_APPS', 'READ_TV_CHANNEL_LIST', 'WRITE_NOTIFICATION_TOAST', 'READ_POWER_STATE', 'READ_COUNTRY_INFO'],
  signatures: [{
    signatureVersion: 1,
    signature: 'eyJhbGdvcml0aG0iOiJSU0EtU0hBMjU2Iiwia2V5SWQiOiJ0ZXN0LXNpZ25pbmctY2VydCIsInNpZ25hdHVyZVZlcnNpb24iOjF9.hrVRgjCwXVvE2OOSpDZ58hR+59aFNwYDyjQgKk3auukd7pcegmE2CzPCa0bJ0ZsRAcKkCTJrWo5iDzNhMBWRyaMOv5zWSrthlf7G128qvIlpMT0YNY+n/FaOHE73uLrS/g7swl3/qH/BGFG2Hu4RlL48eb3lLKqTt2xKHdCs6Cd4RMfJPYnzgvI4BNrFUKsjkcu+WD4OO2A27Pq1n50cMchmcaXadJhGrOqH5YmHdOCj5NSHzJYrsW0HPlpuAx/ECMeIZYDh6RMqaFM2DXzdKX9NmmyqzJ3o/0lkk/N97gfVRLW5hA29yeAwaCViZNCP8iC9aO0q9fQojoa7NQnAtw==',
  }],
};

// Everything SSAP can do directly.
const SSAP = {
  power_off: { uri: 'ssap://system/turnOff' },
  volume_up: { uri: 'ssap://audio/volumeUp' },
  volume_down: { uri: 'ssap://audio/volumeDown' },
  mute: { uri: 'ssap://audio/setMute', toggleMute: true },
  channel_up: { uri: 'ssap://tv/channelUp' },
  channel_down: { uri: 'ssap://tv/channelDown' },
  play: { uri: 'ssap://media.controls/play' },
  pause: { uri: 'ssap://media.controls/pause' },
  play_pause: { uri: 'ssap://media.controls/play' },
  stop: { uri: 'ssap://media.controls/stop' },
  rewind: { uri: 'ssap://media.controls/rewind' },
  forward: { uri: 'ssap://media.controls/fastForward' },
  next: { uri: 'ssap://media.controls/fastForward' },
  previous: { uri: 'ssap://media.controls/rewind' },
};

// Everything that only exists as a pointer-socket button press.
const BUTTON = {
  home: 'HOME', back: 'BACK', menu: 'MENU', exit: 'EXIT', info: 'INFO', guide: 'GUIDE',
  up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', ok: 'ENTER',
  input: 'INPUT_HUB',
  num_0: '0', num_1: '1', num_2: '2', num_3: '3', num_4: '4',
  num_5: '5', num_6: '6', num_7: '7', num_8: '8', num_9: '9',
};

const conns = new Map(); // device.id -> { ws, pointer, muted }

function openSocket(url, timeout) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: timeout });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error(`timed out connecting to ${url}`)); }, timeout);
    ws.once('open', () => { clearTimeout(timer); resolve(ws); });
    ws.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

export async function probe(ip, { timeout = 1500 } = {}) {
  // webOS has no unauthenticated info endpoint, so presence of the SSAP socket
  // is the signal. Opening it without registering does not prompt the TV.
  for (const url of [`wss://${ip}:3001`, `ws://${ip}:3000`]) {
    try {
      const ws = await openSocket(url, timeout);
      ws.close();
      return { brand, ip, name: 'LG TV', needsPairing: true, secure: url.startsWith('wss') };
    } catch {
      // try the next port
    }
  }
  return null;
}

async function handshake(device, { timeout = 40000 } = {}) {
  const url = device.secure === false ? `ws://${device.ip}:3000` : `wss://${device.ip}:3001`;
  const ws = await openSocket(url, Math.min(timeout, 8000));

  const pending = new Map();
  let counter = 0;
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const entry = pending.get(msg.id);
    if (!entry) return;
    // "registered" is the real answer; the earlier PROMPT response just means
    // the TV is now asking the user, so keep waiting.
    if (msg.type === 'response' && msg.payload?.pairingType === 'PROMPT') return;
    pending.delete(msg.id);
    if (msg.type === 'error') entry.reject(new Error(msg.error || 'webOS error'));
    else entry.resolve(msg.payload);
  });

  const send = (type, payload, extra = {}) => new Promise((resolve, reject) => {
    const id = `req-${++counter}`;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, type, ...extra, payload }));
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error('the TV did not answer — was the on-screen prompt accepted?'));
    }, timeout);
  });

  const payload = { forcePairing: false, pairingType: 'PROMPT', manifest: MANIFEST };
  if (device.clientKey) payload['client-key'] = device.clientKey;

  const res = await send('register', payload);
  const key = res?.['client-key'];
  if (!key) throw new Error('the TV did not return a client key');
  if (key !== device.clientKey) {
    device.clientKey = key;
    saveDevice(device);
  }

  const conn = { ws, send, pointer: null, muted: false };
  ws.on('close', () => { if (conns.get(device.id) === conn) conns.delete(device.id); });
  return conn;
}

async function connFor(device, opts) {
  const existing = conns.get(device.id);
  if (existing && existing.ws.readyState === WebSocket.OPEN) return existing;
  const conn = await handshake(device, opts);
  conns.set(device.id, conn);
  return conn;
}

async function pointerFor(device, conn) {
  if (conn.pointer && conn.pointer.readyState === WebSocket.OPEN) return conn.pointer;
  const res = await conn.send('request', {}, { uri: 'ssap://com.webos.service.networkinput/getPointerInputSocket' });
  const path = res?.socketPath;
  if (!path) throw new Error('the TV did not return a pointer input socket');
  conn.pointer = await openSocket(path, 8000);
  return conn.pointer;
}

export async function pair(device) {
  await connFor(device, { timeout: 60000 });
  return { ok: true, message: 'Paired with the TV.' };
}

export async function sendKey(device, key) {
  if (key === 'power') key = 'power_off'; // webOS can only turn itself off; see README on Wake-on-LAN

  // Resolve before connecting, so an unsupported key costs nothing.
  const ssap = SSAP[key];
  if (!ssap && !BUTTON[key]) throw new Error(`LG has no mapping for "${key}"`);

  const conn = await connFor(device);
  if (ssap) {
    if (ssap.toggleMute) {
      conn.muted = !conn.muted;
      await conn.send('request', { mute: conn.muted }, { uri: ssap.uri });
    } else {
      await conn.send('request', {}, { uri: ssap.uri });
    }
    return;
  }

  const pointer = await pointerFor(device, conn);
  pointer.send(`type:button\nname:${BUTTON[key]}\n\n`);
}

export function disconnect(device) {
  const conn = conns.get(device.id);
  if (conn) {
    conn.pointer?.close();
    conn.ws.close();
    conns.delete(device.id);
  }
}

// webOS splits its vocabulary across two sockets; the union is what we support.
export const supportedKeys = [...new Set([...Object.keys(SSAP), ...Object.keys(BUTTON), 'power'])];

export const features = { numpad: true };
