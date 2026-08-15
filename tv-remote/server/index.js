#!/usr/bin/env node
// The whole backend: static file host + a small JSON API the phone talks to.
//
// Deliberately no Express — Node's http module is enough for eight routes, and
// a remote you run on your own laptop shouldn't need a dependency tree.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as adapters from './adapters/index.js';
import { discover, localAddresses } from './discovery.js';
import { listDevices, getDevice, saveDevice, forgetDevice, publicView, storePath } from './store.js';
import { isKey } from './keys.js';

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const PORT = Number(process.env.PORT || 8477);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

async function readBody(req, limit = 1e6) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('invalid JSON body');
  }
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT)) return send(res, 403, { error: 'forbidden' });
  try {
    const data = await readFile(file);
    send(res, 200, data, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

// Resolve :id from the URL into a stored device, or throw a 404-ish error.
function requireDevice(id) {
  const device = getDevice(id);
  if (!device) {
    const err = new Error('device not found — run a scan first');
    err.status = 404;
    throw err;
  }
  return device;
}

const routes = [
  ['GET', /^\/api\/brands$/, async () => adapters.describe()],

  ['GET', /^\/api\/devices$/, async () => listDevices().map(publicView)],

  ['POST', /^\/api\/discover$/, async (req) => {
    const { sweep = true } = await readBody(req);
    const found = await discover({ sweep });
    // Merge rather than overwrite: a rediscovered TV must keep its pairing
    // secrets, but should pick up a fresh name/ip/port.
    return found.map((d) => {
      const prev = getDevice(d.id);
      return publicView(saveDevice({ ...prev, ...d, ...pickSecrets(prev) }));
    });
  }],

  ['POST', /^\/api\/devices\/([^/]+)\/pair$/, async (req, [id]) => {
    const device = requireDevice(decodeURIComponent(id));
    const adapter = adapters.get(device.brand);
    if (!adapter.pair) return { ok: true, message: 'This TV does not need pairing.' };
    const body = await readBody(req);
    const result = await adapter.pair(device, body);
    return { ...result, device: publicView(getDevice(device.id) || device) };
  }],

  ['POST', /^\/api\/devices\/([^/]+)\/key$/, async (req, [id]) => {
    const device = requireDevice(decodeURIComponent(id));
    const { key } = await readBody(req);
    if (!isKey(key)) {
      const err = new Error(`unknown key "${key}"`);
      err.status = 400;
      throw err;
    }
    await adapters.get(device.brand).sendKey(device, key);
    return { ok: true, key };
  }],

  ['GET', /^\/api\/devices\/([^/]+)\/apps$/, async (_req, [id]) => {
    const device = requireDevice(decodeURIComponent(id));
    const adapter = adapters.get(device.brand);
    if (!adapter.apps) return [];
    return adapter.apps(device);
  }],

  ['POST', /^\/api\/devices\/([^/]+)\/launch$/, async (req, [id]) => {
    const device = requireDevice(decodeURIComponent(id));
    const adapter = adapters.get(device.brand);
    if (!adapter.launchApp) throw new Error('this TV cannot launch apps remotely');
    const { appId } = await readBody(req);
    await adapter.launchApp(device, appId);
    return { ok: true };
  }],

  ['POST', /^\/api\/devices\/([^/]+)\/text$/, async (req, [id]) => {
    const device = requireDevice(decodeURIComponent(id));
    const adapter = adapters.get(device.brand);
    if (!adapter.typeText) throw new Error('this TV cannot accept typed text');
    const { text } = await readBody(req);
    await adapter.typeText(device, String(text || ''));
    return { ok: true };
  }],

  ['POST', /^\/api\/devices$/, async (req) => {
    // Manual add, for when discovery comes up empty but you know the IP.
    const { ip, brand } = await readBody(req);
    if (!ip || !brand) throw new Error('ip and brand are required');
    const adapter = adapters.get(brand);
    const found = (await adapter.probe(ip, { timeout: 4000 })) || { brand, ip, name: adapter.label, needsPairing: adapter.needsPairing };
    return publicView(saveDevice({ ...found, id: `${brand}:${ip}` }));
  }],

  ['DELETE', /^\/api\/devices\/([^/]+)$/, async (_req, [id]) => {
    const target = decodeURIComponent(id);
    const device = getDevice(target);
    if (device) adapters.get(device.brand).disconnect?.(device);
    return { ok: forgetDevice(target) };
  }],
];

// Carry pairing secrets across a rediscovery.
function pickSecrets(prev) {
  if (!prev) return {};
  const { token, clientKey, authToken, psk, pairDeviceId } = prev;
  return Object.fromEntries(Object.entries({ token, clientKey, authToken, psk, pairDeviceId }).filter(([, v]) => v !== undefined));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);

  for (const [method, pattern, handler] of routes) {
    const match = url.pathname.match(pattern);
    if (!match) continue;
    if (req.method !== method) continue;
    try {
      const result = await handler(req, match.slice(1));
      return send(res, 200, result);
    } catch (err) {
      // "no mapping" means the brand can't do this key — a client mistake, not
      // a server fault.
      const status = err.status || (/no mapping/.test(err.message || '') ? 400 : 500);
      // The message is the user-facing help text here ("accept the prompt on
      // the TV", "wrong PIN?"), so pass it through rather than swallowing it.
      return send(res, status, { error: err.message || 'something went wrong' });
    }
  }
  send(res, 404, { error: 'no such endpoint' });
});

if (process.argv.includes('--scan-only')) {
  const found = await discover({
    onProgress: (p) => {
      if (p.phase === 'ssdp') console.log(`SSDP: ${p.found} candidate(s)`);
      else if (p.done) process.stdout.write(`\rSweeping subnet... ${p.done}/${p.total}`);
    },
  });
  console.log('\n');
  if (!found.length) console.log('No TVs found. See the Troubleshooting section of the README.');
  for (const d of found) {
    saveDevice({ ...d, ...pickSecrets(getDevice(d.id)) });
    console.log(`  ${d.name}  [${d.brand}]  ${d.ip}${d.needsPairing ? '  (needs pairing)' : ''}`);
  }
  console.log(`\nSaved to ${storePath()}`);
  process.exit(0);
}

server.listen(PORT, '0.0.0.0', () => {
  const lan = localAddresses()[0]?.address;
  console.log('\n  TV Remote is running.\n');
  console.log(`  On this machine:  http://localhost:${PORT}`);
  if (lan) console.log(`  On your phone:    http://${lan}:${PORT}   <- open this one\n`);
  else console.log('  Could not detect a LAN address; check that WiFi is connected.\n');
  console.log('  Phone and TV must be on the same network. Ctrl+C to stop.\n');
});
