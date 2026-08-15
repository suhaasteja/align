// Samsung Tizen TVs (2016 and later).
//
// Control is a WebSocket on 8002 (TLS, self-signed). The first connection makes
// the TV show an "Allow this device?" prompt; accepting it returns a token that
// we persist, and subsequent connections are silent.
//
// Pre-2016 Samsungs speak a different, unencrypted protocol on 8001/55000 and
// are not supported here.

import { WebSocket } from 'ws';
import { httpJson } from '../http.js';
import { saveDevice } from '../store.js';

export const brand = 'samsung';
export const label = 'Samsung';
export const needsPairing = true;
export const pairingKind = 'confirm'; // user presses Allow on the TV itself
const PORT = 8002;
const CLIENT_NAME = 'Phone Remote';

const MAP = {
  power: 'KEY_POWER', power_on: 'KEY_POWERON', power_off: 'KEY_POWEROFF',
  home: 'KEY_HOME', back: 'KEY_RETURN', menu: 'KEY_MENU', exit: 'KEY_EXIT',
  info: 'KEY_INFO', guide: 'KEY_GUIDE',
  up: 'KEY_UP', down: 'KEY_DOWN', left: 'KEY_LEFT', right: 'KEY_RIGHT', ok: 'KEY_ENTER',
  volume_up: 'KEY_VOLUP', volume_down: 'KEY_VOLDOWN', mute: 'KEY_MUTE',
  channel_up: 'KEY_CHUP', channel_down: 'KEY_CHDOWN',
  play_pause: 'KEY_PLAY_BACK', play: 'KEY_PLAY', pause: 'KEY_PAUSE', stop: 'KEY_STOP',
  rewind: 'KEY_REWIND', forward: 'KEY_FF',
  next: 'KEY_FF', previous: 'KEY_REWIND',
  input: 'KEY_SOURCE',
  num_0: 'KEY_0', num_1: 'KEY_1', num_2: 'KEY_2', num_3: 'KEY_3', num_4: 'KEY_4',
  num_5: 'KEY_5', num_6: 'KEY_6', num_7: 'KEY_7', num_8: 'KEY_8', num_9: 'KEY_9',
};

export async function probe(ip, { timeout = 1500 } = {}) {
  try {
    const info = await httpJson(`http://${ip}:8001/api/v2/`, { timeout });
    const d = info?.device;
    if (!d) return null;
    return {
      brand,
      ip,
      name: d.name || 'Samsung TV',
      model: d.modelName || undefined,
      mac: d.wifiMac || undefined,
      needsPairing: true,
    };
  } catch {
    return null;
  }
}

function socketUrl(device) {
  const name = Buffer.from(CLIENT_NAME).toString('base64');
  const base = `wss://${device.ip}:${PORT}/api/v2/channels/samsung.remote.control?name=${name}`;
  return device.token ? `${base}&token=${device.token}` : base;
}

// One live socket per TV. Reconnecting for every keypress makes the remote feel
// sluggish and (on some models) re-triggers the allow prompt.
const sockets = new Map();

function connect(device, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl(device), { rejectUnauthorized: false, handshakeTimeout: timeout });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('Samsung TV did not respond. If this is the first pairing, accept the prompt on the TV screen.'));
    }, timeout);

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.event === 'ms.channel.connect') {
        clearTimeout(timer);
        const token = msg.data?.token;
        if (token && token !== device.token) {
          device.token = token;
          saveDevice(device);
        }
        resolve(ws);
      }
      if (msg.event === 'ms.channel.unauthorized') {
        clearTimeout(timer);
        ws.terminate();
        reject(new Error('The TV denied this device. On the TV: Settings > General > External Device Manager > Device Connection Manager, remove "Phone Remote", then pair again.'));
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (sockets.get(device.id)?.ws === ws) sockets.delete(device.id);
    });
  });
}

async function socketFor(device, opts) {
  const existing = sockets.get(device.id);
  if (existing && existing.ws.readyState === WebSocket.OPEN) return existing.ws;
  const ws = await connect(device, opts);
  sockets.set(device.id, { ws });
  return ws;
}

export async function pair(device) {
  // Connecting *is* the pairing handshake; the token falls out of it.
  const ws = await socketFor(device, { timeout: 40000 });
  if (ws.readyState !== WebSocket.OPEN) throw new Error('pairing socket closed unexpectedly');
  return { ok: true, message: 'Paired with the TV.' };
}

export async function sendKey(device, key) {
  const code = MAP[key];
  if (!code) throw new Error(`Samsung has no mapping for "${key}"`);
  const ws = await socketFor(device);
  ws.send(JSON.stringify({
    method: 'ms.remote.control',
    params: { Cmd: 'Click', DataOfCmd: code, Option: 'false', TypeOfRemote: 'SendRemoteKey' },
  }));
}

export function disconnect(device) {
  const entry = sockets.get(device.id);
  if (entry) {
    entry.ws.close();
    sockets.delete(device.id);
  }
}

export const supportedKeys = Object.keys(MAP);

export const features = { numpad: true };
