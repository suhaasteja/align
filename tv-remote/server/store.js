// Tiny JSON-file store for discovered devices and their pairing secrets.
//
// Samsung hands back a token, LG a client-key, Vizio an auth-token, Sony wants
// a pre-shared key. All of them are "remember this forever or the TV will
// re-prompt every time", so they live on disk next to the device record.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const DIR = process.env.TV_REMOTE_HOME || join(homedir(), '.tv-remote');
const FILE = join(DIR, 'devices.json');

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    cache = { devices: {} };
  }
  if (!cache.devices) cache.devices = {};
  return cache;
}

function persist() {
  mkdirSync(dirname(FILE), { recursive: true });
  // Mode 0600: these are credentials that can turn on someone's TV.
  writeFileSync(FILE, JSON.stringify(cache, null, 2), { mode: 0o600 });
}

export function deviceId(brand, ip) {
  return `${brand}:${ip}`;
}

export function listDevices() {
  return Object.values(load().devices);
}

export function getDevice(id) {
  return load().devices[id] || null;
}

export function saveDevice(device) {
  const db = load();
  const id = device.id || deviceId(device.brand, device.ip);
  db.devices[id] = { ...(db.devices[id] || {}), ...device, id };
  persist();
  return db.devices[id];
}

export function forgetDevice(id) {
  const db = load();
  const existed = Boolean(db.devices[id]);
  delete db.devices[id];
  persist();
  return existed;
}

// The UI must never see tokens/PSKs — it doesn't need them and they'd end up in
// browser history, screenshots and bug reports.
export function publicView(device) {
  const { token, clientKey, authToken, psk, ...safe } = device;
  return { ...safe, paired: Boolean(token || clientKey || authToken || psk || device.needsPairing === false) };
}

export function storePath() {
  return FILE;
}
