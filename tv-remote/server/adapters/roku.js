// Roku — External Control Protocol (ECP).
//
// By far the friendliest of the bunch: plain HTTP on port 8060, no pairing, no
// token, no TLS. If "Control by mobile apps" is enabled (it is by default) this
// just works.

import { httpText, TimeoutError } from '../http.js';

export const brand = 'roku';
export const label = 'Roku';
export const needsPairing = false;
const PORT = 8060;

const MAP = {
  power: 'Power', power_on: 'PowerOn', power_off: 'PowerOff',
  home: 'Home', back: 'Back', menu: 'Info', exit: 'Home', info: 'Info',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right', ok: 'Select',
  volume_up: 'VolumeUp', volume_down: 'VolumeDown', mute: 'VolumeMute',
  channel_up: 'ChannelUp', channel_down: 'ChannelDown',
  play_pause: 'Play', play: 'Play', pause: 'Play',
  rewind: 'Rev', forward: 'Fwd',
  next: 'Fwd', previous: 'Rev',
  input: 'InputHDMI1',
};

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

export async function probe(ip, { timeout = 1500 } = {}) {
  try {
    const xml = await httpText(`http://${ip}:${PORT}/query/device-info`, { timeout });
    if (!xml.includes('device-info')) return null;
    return {
      brand,
      ip,
      name: tag(xml, 'user-device-name') || tag(xml, 'friendly-device-name') || tag(xml, 'model-name') || 'Roku',
      model: tag(xml, 'model-name') || undefined,
      needsPairing: false,
    };
  } catch (err) {
    if (err instanceof TimeoutError) return null;
    return null;
  }
}

export async function sendKey(device, key) {
  const code = MAP[key];
  if (!code) throw new Error(`Roku has no mapping for "${key}"`);
  await httpText(`http://${device.ip}:${PORT}/keypress/${code}`, { method: 'POST', timeout: 3000 });
}

// Roku is the one platform where launching apps is trivial, so expose it.
export async function apps(device) {
  const xml = await httpText(`http://${device.ip}:${PORT}/query/apps`, { timeout: 3000 });
  const out = [];
  const re = /<app id="([^"]+)"[^>]*>([^<]*)<\/app>/g;
  let m;
  while ((m = re.exec(xml))) out.push({ id: m[1], name: m[2].trim() });
  return out;
}

export async function launchApp(device, appId) {
  await httpText(`http://${device.ip}:${PORT}/launch/${encodeURIComponent(appId)}`, { method: 'POST', timeout: 3000 });
}

// Typing a search query with a D-pad is misery; ECP can inject literal chars.
export async function typeText(device, text) {
  for (const ch of [...text].slice(0, 200)) {
    const lit = `Lit_${encodeURIComponent(ch)}`;
    await httpText(`http://${device.ip}:${PORT}/keypress/${lit}`, { method: 'POST', timeout: 3000 });
  }
}

export const supportedKeys = Object.keys(MAP);

export const features = { apps: true, text: true };
