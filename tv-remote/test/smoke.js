// End-to-end smoke test against a mock Roku.
//
// Verifies the parts that don't need real hardware: the Roku adapter's probe /
// key / app calls, the persistence layer, and every HTTP route on the server.
// The pairing-based brands (Samsung, LG, Vizio, Sony) can't be tested without a
// TV, so their adapters are only checked for load + key-map coverage.

import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TV_REMOTE_HOME = mkdtempSync(join(tmpdir(), 'tv-remote-test-'));
process.env.PORT = '8479';

const pressed = [];

const mockTv = http.createServer((req, res) => {
  if (req.url === '/query/device-info') {
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    return res.end('<device-info><user-device-name>Living Room TV</user-device-name><model-name>Roku Ultra</model-name></device-info>');
  }
  if (req.url === '/query/apps') {
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    return res.end('<apps><app id="12" type="appl">Netflix</app><app id="837">YouTube</app></apps>');
  }
  if (req.url.startsWith('/keypress/')) { pressed.push(decodeURIComponent(req.url.slice(10))); res.writeHead(200); return res.end(); }
  if (req.url.startsWith('/launch/')) { pressed.push(`LAUNCH:${req.url.slice(8)}`); res.writeHead(200); return res.end(); }
  res.writeHead(404); res.end();
});

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/* ---------- adapter-level ---------- */

test('roku probe reads the TV name and model', async () => {
  const roku = await import('../server/adapters/roku.js');
  const found = await roku.probe('127.0.0.1');
  assert.equal(found.name, 'Living Room TV');
  assert.equal(found.model, 'Roku Ultra');
  assert.equal(found.needsPairing, false);
});

test('roku probe returns null for a dead host without hanging', async () => {
  const roku = await import('../server/adapters/roku.js');
  const started = Date.now();
  const found = await roku.probe('127.0.0.99', { timeout: 800 });
  assert.equal(found, null);
  assert.ok(Date.now() - started < 3000, 'probe should give up quickly');
});

test('canonical keys translate to Roku codes', async () => {
  const roku = await import('../server/adapters/roku.js');
  const device = { brand: 'roku', ip: '127.0.0.1', id: 'roku:127.0.0.1' };
  pressed.length = 0;
  for (const k of ['power', 'up', 'ok', 'volume_up', 'play_pause', 'home', 'back']) {
    await roku.sendKey(device, k);
  }
  assert.deepEqual(pressed, ['Power', 'Up', 'Select', 'VolumeUp', 'Play', 'Home', 'Back']);
});

test('an unmapped key is rejected rather than silently dropped', async () => {
  const roku = await import('../server/adapters/roku.js');
  await assert.rejects(
    () => roku.sendKey({ ip: '127.0.0.1' }, 'guide'),
    /no mapping/,
  );
});

test('every adapter covers the keys a remote is useless without', async () => {
  const adapters = await import('../server/adapters/index.js');
  // `home` is deliberately absent from this list — Vizio has no documented HOME
  // code, and the UI greys it out for that brand.
  const core = ['power', 'up', 'down', 'left', 'right', 'ok', 'volume_up', 'volume_down', 'mute', 'back'];
  for (const adapter of adapters.all) {
    const supported = new Set(adapter.supportedKeys);
    for (const key of core) {
      const has = supported.has(key) || (key === 'power' && supported.has('power_off'));
      assert.ok(has, `${adapter.brand} is missing "${key}"`);
    }
  }
});

test('declared keys match what sendKey actually accepts', async () => {
  const adapters = await import('../server/adapters/index.js');
  const { KEYS } = await import('../server/keys.js');
  for (const adapter of adapters.all) {
    const declared = new Set(adapter.supportedKeys);
    for (const key of KEYS) {
      // Point at a dead host: "no mapping" means the key was rejected before
      // any network call, anything else means it resolved and tried to send.
      const err = await adapter.sendKey({ ip: '127.0.0.99', id: `${adapter.brand}:x`, psk: 'x', authToken: 'x', port: 1 }, key)
        .then(() => null, (e) => e);
      const unmapped = /no mapping/.test(err?.message || '');
      assert.equal(unmapped, !declared.has(key), `${adapter.brand}.${key}: declared=${declared.has(key)} but unmapped=${unmapped}`);
    }
  }
});

test('a key the brand cannot do is a 400 with a readable reason', async () => {
  const adapters = await import('../server/adapters/index.js');
  const vizio = adapters.get('vizio');
  assert.ok(!vizio.supportedKeys.includes('home'), 'test assumes Vizio lacks home');
  await assert.rejects(() => vizio.sendKey({ ip: '127.0.0.99', authToken: 'x' }, 'home'), /no mapping for "home"/);
});

/* ---------- store ---------- */

test('pairing secrets survive a save/read round-trip but never reach the UI', async () => {
  const store = await import('../server/store.js');
  store.saveDevice({ id: 'samsung:1.2.3.4', brand: 'samsung', ip: '1.2.3.4', name: 'Bedroom', token: 'secret-token' });
  const read = store.getDevice('samsung:1.2.3.4');
  assert.equal(read.token, 'secret-token');

  const view = store.publicView(read);
  assert.equal(view.token, undefined, 'token must not be exposed to the client');
  assert.equal(view.paired, true, 'a device with a token reads as paired');
});

/* ---------- HTTP API ---------- */

const base = `http://127.0.0.1:${process.env.PORT}`;
const call = async (path, opts = {}) => {
  const res = await fetch(base + path, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('GET /api/brands lists every supported brand', async () => {
  const { body } = await call('/api/brands');
  assert.deepEqual(body.map((b) => b.brand).sort(), ['lg', 'roku', 'samsung', 'sony', 'vizio']);
  assert.equal(body.find((b) => b.brand === 'vizio').pairingKind, 'pin');
});

test('POST /api/devices adds a TV by IP', async () => {
  const { status, body } = await call('/api/devices', {
    method: 'POST',
    body: JSON.stringify({ ip: '127.0.0.1', brand: 'roku' }),
  });
  assert.equal(status, 200);
  assert.equal(body.name, 'Living Room TV');
  assert.equal(body.paired, true, 'Roku needs no pairing');
});

test('POST .../key forwards a press to the TV', async () => {
  pressed.length = 0;
  const { status } = await call('/api/devices/roku%3A127.0.0.1/key', {
    method: 'POST',
    body: JSON.stringify({ key: 'volume_down' }),
  });
  assert.equal(status, 200);
  assert.deepEqual(pressed, ['VolumeDown']);
});

test('a bogus key is a 400, not a 500', async () => {
  const { status, body } = await call('/api/devices/roku%3A127.0.0.1/key', {
    method: 'POST',
    body: JSON.stringify({ key: 'self_destruct' }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /unknown key/);
});

test('an unknown device is a 404 with a useful message', async () => {
  const { status, body } = await call('/api/devices/roku%3A9.9.9.9/key', {
    method: 'POST',
    body: JSON.stringify({ key: 'ok' }),
  });
  assert.equal(status, 404);
  assert.match(body.error, /not found/);
});

test('GET .../apps lists installed apps and launch works', async () => {
  const { body } = await call('/api/devices/roku%3A127.0.0.1/apps');
  assert.deepEqual(body, [{ id: '12', name: 'Netflix' }, { id: '837', name: 'YouTube' }]);

  pressed.length = 0;
  await call('/api/devices/roku%3A127.0.0.1/launch', { method: 'POST', body: JSON.stringify({ appId: '12' }) });
  assert.deepEqual(pressed, ['LAUNCH:12']);
});

test('typed text is sent one literal char at a time', async () => {
  pressed.length = 0;
  await call('/api/devices/roku%3A127.0.0.1/text', { method: 'POST', body: JSON.stringify({ text: 'hi' }) });
  assert.deepEqual(pressed, ['Lit_h', 'Lit_i']);
});

test('static files are served and path traversal is blocked', async () => {
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>TV Remote<\/title>/);

  const escape = await fetch(base + '/../package.json');
  assert.notEqual(escape.status, 200, 'must not serve files outside public/');
});

test('DELETE forgets a device', async () => {
  const { body } = await call('/api/devices/roku%3A127.0.0.1', { method: 'DELETE' });
  assert.equal(body.ok, true);
  const list = await call('/api/devices');
  assert.equal(list.body.find((d) => d.id === 'roku:127.0.0.1'), undefined);
});

/* ---------- optional PIN ---------- */

// The PIN is read at module load, so it needs its own server process.
test('TV_REMOTE_PIN gates the API but not the page itself', async () => {
  const { spawn } = await import('node:child_process');
  const port = 8482;
  const child = spawn(process.execPath, [new URL('../server/index.js', import.meta.url).pathname], {
    env: { ...process.env, PORT: String(port), TV_REMOTE_PIN: 's3cret' },
    stdio: 'ignore',
  });

  try {
    // Wait for it to bind.
    for (let i = 0; i < 40; i++) {
      try { await fetch(`http://127.0.0.1:${port}/api/auth`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }

    const noPin = await fetch(`http://127.0.0.1:${port}/api/devices`);
    assert.equal(noPin.status, 401, 'API must reject a request with no PIN');

    const wrongPin = await fetch(`http://127.0.0.1:${port}/api/devices`, { headers: { 'x-remote-pin': 'nope' } });
    assert.equal(wrongPin.status, 401, 'API must reject a wrong PIN');

    const goodPin = await fetch(`http://127.0.0.1:${port}/api/devices`, { headers: { 'x-remote-pin': 's3cret' } });
    assert.equal(goodPin.status, 200, 'API must accept the right PIN');

    // The page has to load unauthenticated, or there's no way to type the PIN.
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200, 'static files must remain reachable');

    const probe = await fetch(`http://127.0.0.1:${port}/api/auth`).then((r) => r.json());
    assert.deepEqual(probe, { required: true, ok: false });
  } finally {
    child.kill();
  }
});

test('with no PIN configured the API stays open', async () => {
  const probe = await call('/api/auth');
  assert.deepEqual(probe.body, { required: false, ok: true });
});

/* ---------- runner ---------- */

await new Promise((r) => mockTv.listen(8060, '127.0.0.1', r));
await import('../server/index.js');
await new Promise((r) => setTimeout(r, 300)); // let the server bind

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
