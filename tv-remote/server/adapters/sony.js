// Sony Bravia — IRCC-IP over SOAP.
//
// No interactive pairing: you set a Pre-Shared Key on the TV itself
// (Settings > Network > Home Network Setup > IP Control > Authentication:
// "Normal and Pre-Shared Key"), then send it as a header. Key codes are opaque
// base64 blobs baked into the firmware.

import { httpText, httpJson } from '../http.js';
import { saveDevice } from '../store.js';

export const brand = 'sony';
export const label = 'Sony Bravia';
export const needsPairing = true;
export const pairingKind = 'psk'; // user copies a key they set on the TV

const MAP = {
  power: 'AAAAAQAAAAEAAAAVAw==', power_on: 'AAAAAQAAAAEAAAAuAw==', power_off: 'AAAAAQAAAAEAAAAvAw==',
  home: 'AAAAAQAAAAEAAABgAw==', back: 'AAAAAgAAAJcAAAAjAw==', menu: 'AAAAAgAAAEsAAAAQAw==',
  exit: 'AAAAAQAAAAEAAABjAw==', info: 'AAAAAQAAAAEAAAA6Aw==', guide: 'AAAAAgAAAKQAAABbAw==',
  up: 'AAAAAQAAAAEAAAB0Aw==', down: 'AAAAAQAAAAEAAAB1Aw==',
  left: 'AAAAAQAAAAEAAAA0Aw==', right: 'AAAAAQAAAAEAAAAzAw==', ok: 'AAAAAQAAAAEAAABlAw==',
  volume_up: 'AAAAAQAAAAEAAAASAw==', volume_down: 'AAAAAQAAAAEAAAATAw==', mute: 'AAAAAQAAAAEAAAAUAw==',
  channel_up: 'AAAAAQAAAAEAAAAQAw==', channel_down: 'AAAAAQAAAAEAAAARAw==',
  play: 'AAAAAgAAAJcAAAAaAw==', pause: 'AAAAAgAAAJcAAAAZAw==', play_pause: 'AAAAAgAAAJcAAAAaAw==',
  stop: 'AAAAAgAAAJcAAAAYAw==', rewind: 'AAAAAgAAAJcAAAAbAw==', forward: 'AAAAAgAAAJcAAAAcAw==',
  next: 'AAAAAgAAAJcAAAA5Aw==', previous: 'AAAAAgAAAJcAAAA8Aw==',
  input: 'AAAAAQAAAAEAAAAlAw==',
  num_0: 'AAAAAQAAAAEAAAAJAw==', num_1: 'AAAAAQAAAAEAAAAAAw==', num_2: 'AAAAAQAAAAEAAAABAw==',
  num_3: 'AAAAAQAAAAEAAAACAw==', num_4: 'AAAAAQAAAAEAAAADAw==', num_5: 'AAAAAQAAAAEAAAAEAw==',
  num_6: 'AAAAAQAAAAEAAAAFAw==', num_7: 'AAAAAQAAAAEAAAAGAw==', num_8: 'AAAAAQAAAAEAAAAHAw==',
  num_9: 'AAAAAQAAAAEAAAAIAw==',
};

export async function probe(ip, { timeout = 1500 } = {}) {
  try {
    // getSystemInformation is readable without the PSK on most firmware; even
    // when it 403s, an answer at this path means we're talking to a Bravia.
    const res = await httpJson(`http://${ip}/sony/system`, {
      method: 'POST',
      timeout,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'getSystemInformation', id: 1, params: [], version: '1.0' }),
    }).catch((err) => err.body);
    if (!res || typeof res !== 'object' || (!('result' in res) && !('error' in res))) return null;
    const info = res.result?.[0] || {};
    return {
      brand,
      ip,
      name: info.name || 'Sony Bravia',
      model: info.model || undefined,
      needsPairing: true,
    };
  } catch {
    return null;
  }
}

export async function pair(device, { psk } = {}) {
  if (!psk) throw new Error('A Pre-Shared Key is required. Set one on the TV under Settings > Network > IP Control.');
  const previous = device.psk;
  device.psk = String(psk).trim();
  try {
    await sendKey(device, 'info'); // harmless round-trip that proves the PSK works
  } catch (err) {
    device.psk = previous;
    throw new Error(`The TV rejected that key: ${err.message}`);
  }
  saveDevice(device);
  return { ok: true, message: 'Pre-shared key accepted.' };
}

export async function sendKey(device, key) {
  const code = MAP[key];
  if (!code) throw new Error(`Sony has no mapping for "${key}"`);
  if (!device.psk) throw new Error('no pre-shared key set');

  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:X_SendIRCC xmlns:u="urn:schemas-sony-com:service:IRCC:1"><IRCCCode>${code}</IRCCCode></u:X_SendIRCC></s:Body></s:Envelope>`;

  await httpText(`http://${device.ip}/sony/IRCC`, {
    method: 'POST',
    timeout: 5000,
    headers: {
      'Content-Type': 'text/xml; charset=UTF-8',
      'SOAPACTION': '"urn:schemas-sony-com:service:IRCC:1#X_SendIRCC"',
      'X-Auth-PSK': device.psk,
    },
    body,
  });
}

export const supportedKeys = Object.keys(MAP);

export const features = { numpad: true };
