// Front-end for the remote.
//
// Kept to one file, no framework. The interesting parts are the input handling
// (pointerdown, not click — a remote must fire on press, not release) and the
// pairing flows, which differ per brand.

const $ = (id) => document.getElementById(id);

const state = {
  devices: [],
  current: null,
  brands: {},
};

/* ---------------- API ---------------- */

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

/* ---------------- chrome ---------------- */

let toastTimer;
function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 5200 : 2000);
}

function openSheet(html) {
  $('sheetBody').innerHTML = html;
  $('sheet').hidden = false;
  $('backdrop').hidden = false;
}

function closeSheet() {
  $('sheet').hidden = true;
  $('backdrop').hidden = true;
}

$('backdrop').addEventListener('click', closeSheet);

function buzz(ms = 12) {
  // Physical remotes have a click. This is the closest we get.
  if (navigator.vibrate) navigator.vibrate(ms);
}

/* ---------------- device selection ---------------- */

function setCurrent(device) {
  state.current = device;
  if (device) localStorage.setItem('tv-remote:last', device.id);

  $('deviceName').textContent = device ? device.name : 'No TV yet';
  $('statusDot').className = 'dot ' + (!device ? '' : device.paired ? 'online' : 'warn');
  $('remote').hidden = !device;
  $('empty').hidden = Boolean(device);

  if (!device) return;

  const brand = state.brands[device.brand] || {};
  $('toggleNumpad').hidden = !brand.features?.numpad;
  $('toggleApps').hidden = !brand.features?.apps;
  $('toggleKeyboard').hidden = !brand.features?.text;

  // Not every brand can do every key (Vizio has no HOME, for instance). Dim
  // those rather than letting the user press something that will only error.
  const supported = new Set(brand.keys || []);
  for (const el of document.querySelectorAll('[data-key]')) {
    const ok = !supported.size || supported.has(el.dataset.key)
      || (el.dataset.key === 'power' && (supported.has('power_off') || supported.has('power_on')));
    el.classList.toggle('unsupported', !ok);
    el.disabled = !ok;
  }
  $('numpad').hidden = true;
  $('apps').hidden = true;
  $('keyboard').hidden = true;

  if (!device.paired) promptPairing(device);
}

function renderDeviceSheet() {
  const items = state.devices.map((d) => `
    <button class="dev-item ${state.current?.id === d.id ? 'active' : ''}" data-id="${d.id}">
      <span class="dot ${d.paired ? 'online' : 'warn'}"></span>
      <span class="dev-meta">
        ${escapeHtml(d.name)}
        <small>${escapeHtml(state.brands[d.brand]?.label || d.brand)} &middot; ${escapeHtml(d.ip)}</small>
      </span>
      ${d.paired ? '' : '<span class="badge">pair</span>'}
    </button>`).join('');

  openSheet(`
    <h2>Your TVs</h2>
    <p>${state.devices.length ? 'Tap one to control it.' : 'Nothing found yet.'}</p>
    ${items}
    <div class="row-actions">
      <button class="btn" id="rescan">Scan again</button>
      <button class="btn" id="manual2">Add by IP</button>
    </div>
    ${state.current ? '<div class="row-actions"><button class="btn" id="forget">Forget this TV</button></div>' : ''}
  `);

  $('sheetBody').querySelectorAll('.dev-item').forEach((el) => {
    el.addEventListener('click', () => {
      setCurrent(state.devices.find((d) => d.id === el.dataset.id));
      closeSheet();
    });
  });
  $('rescan').addEventListener('click', () => { closeSheet(); scan(); });
  $('manual2').addEventListener('click', () => { closeSheet(); manualAdd(); });
  $('forget')?.addEventListener('click', async () => {
    const id = state.current.id;
    closeSheet();
    await api(`/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refreshDevices();
    setCurrent(state.devices[0] || null);
    toast('Forgotten.');
  });
}

$('devicePicker').addEventListener('click', renderDeviceSheet);

/* ---------------- discovery ---------------- */

async function refreshDevices() {
  state.devices = await api('/devices');
  return state.devices;
}

async function scan() {
  const status = $('scanStatus');
  const btn = $('scanBtn');
  btn.disabled = true;
  status.textContent = 'Looking for TVs on your network...';

  try {
    state.devices = await api('/discover', { method: 'POST', body: { sweep: true } });
    if (!state.devices.length) {
      status.textContent = 'No TVs found. Check that this computer and the TV are on the same WiFi, then try again — or add it by IP.';
      return;
    }
    status.textContent = `Found ${state.devices.length}.`;
    const last = localStorage.getItem('tv-remote:last');
    setCurrent(state.devices.find((d) => d.id === last) || state.devices[0]);
  } catch (err) {
    status.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

$('scanBtn').addEventListener('click', scan);

function manualAdd() {
  const options = Object.values(state.brands)
    .map((b) => `<option value="${b.brand}">${escapeHtml(b.label)}</option>`).join('');
  openSheet(`
    <h2>Add by IP</h2>
    <p>Find the TV's IP under Settings &rarr; Network &rarr; Status on the TV itself.</p>
    <input type="text" id="ipInput" placeholder="192.168.1.42" inputmode="decimal" autocomplete="off">
    <select id="brandInput">${options}</select>
    <button class="btn primary" id="addBtn">Add TV</button>
  `);
  $('manualBtn') && ($('manualBtn').disabled = false);
  $('addBtn').addEventListener('click', async () => {
    const ip = $('ipInput').value.trim();
    if (!ip) return toast('Enter an IP address', true);
    $('addBtn').disabled = true;
    try {
      const device = await api('/devices', { method: 'POST', body: { ip, brand: $('brandInput').value } });
      closeSheet();
      await refreshDevices();
      setCurrent(state.devices.find((d) => d.id === device.id) || device);
    } catch (err) {
      $('addBtn').disabled = false;
      toast(err.message, true);
    }
  });
}

$('manualBtn').addEventListener('click', manualAdd);

/* ---------------- pairing ---------------- */

function promptPairing(device) {
  const brand = state.brands[device.brand] || {};
  const kind = brand.pairingKind;

  if (kind === 'pin') return pairWithPin(device);
  if (kind === 'psk') return pairWithPsk(device);

  // 'confirm' — the TV puts an allow/deny dialog on screen.
  openSheet(`
    <h2>Pair with ${escapeHtml(device.name)}</h2>
    <p>Your TV will show a permission prompt. Accept it with the TV's own controls (or the buttons on the TV itself), then come back here.</p>
    <button class="btn primary" id="pairBtn">Start pairing</button>
  `);
  $('pairBtn').addEventListener('click', async () => {
    $('pairBtn').disabled = true;
    $('pairBtn').textContent = 'Waiting for the TV...';
    try {
      await api(`/devices/${encodeURIComponent(device.id)}/pair`, { method: 'POST', body: {} });
      await afterPair(device);
    } catch (err) {
      $('pairBtn').disabled = false;
      $('pairBtn').textContent = 'Try again';
      toast(err.message, true);
    }
  });
}

function pairWithPin(device) {
  openSheet(`
    <h2>Pair with ${escapeHtml(device.name)}</h2>
    <p>Tap Show PIN, then type the four digits that appear on the TV.</p>
    <button class="btn primary" id="startBtn">Show PIN on TV</button>
    <div id="pinStep" hidden>
      <input type="tel" id="pinInput" class="pin-input" placeholder="0000" maxlength="8" inputmode="numeric">
      <button class="btn primary" id="pinBtn">Pair</button>
    </div>
  `);

  $('startBtn').addEventListener('click', async () => {
    $('startBtn').disabled = true;
    try {
      await api(`/devices/${encodeURIComponent(device.id)}/pair`, { method: 'POST', body: {} });
      $('startBtn').hidden = true;
      $('pinStep').hidden = false;
      $('pinInput').focus();
    } catch (err) {
      $('startBtn').disabled = false;
      toast(err.message, true);
    }
  });

  $('pinBtn').addEventListener('click', async () => {
    const pin = $('pinInput').value.trim();
    if (!pin) return toast('Enter the PIN from the TV', true);
    $('pinBtn').disabled = true;
    try {
      await api(`/devices/${encodeURIComponent(device.id)}/pair`, { method: 'POST', body: { pin } });
      await afterPair(device);
    } catch (err) {
      $('pinBtn').disabled = false;
      toast(err.message, true);
    }
  });
}

function pairWithPsk(device) {
  openSheet(`
    <h2>Pair with ${escapeHtml(device.name)}</h2>
    <p>On the TV: Settings &rarr; Network &rarr; Home Network Setup &rarr; IP Control. Set Authentication to "Normal and Pre-Shared Key" and choose a key, then enter the same key here.</p>
    <input type="text" id="pskInput" placeholder="Pre-shared key" autocomplete="off">
    <button class="btn primary" id="pskBtn">Save</button>
  `);
  $('pskBtn').addEventListener('click', async () => {
    const psk = $('pskInput').value.trim();
    if (!psk) return toast('Enter the key you set on the TV', true);
    $('pskBtn').disabled = true;
    try {
      await api(`/devices/${encodeURIComponent(device.id)}/pair`, { method: 'POST', body: { psk } });
      await afterPair(device);
    } catch (err) {
      $('pskBtn').disabled = false;
      toast(err.message, true);
    }
  });
}

async function afterPair(device) {
  closeSheet();
  await refreshDevices();
  setCurrent(state.devices.find((d) => d.id === device.id) || device);
  toast('Paired. Try the volume buttons.');
}

/* ---------------- sending keys ---------------- */

let inFlight = 0;

async function press(el) {
  const key = el.dataset.key;
  if (!key || !state.current) return;

  buzz();
  el.classList.add('hit');
  setTimeout(() => el.classList.remove('hit'), 110);

  // Held keys (volume, arrows) can outrun the TV. Cap the queue so a long press
  // doesn't build a backlog that keeps firing after the finger lifts.
  if (inFlight > 3) return;
  inFlight++;
  try {
    await api(`/devices/${encodeURIComponent(state.current.id)}/key`, { method: 'POST', body: { key } });
  } catch (err) {
    toast(err.message, true);
  } finally {
    inFlight--;
  }
}

// pointerdown, not click: a remote should respond the instant you touch it.
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('[data-key]');
  if (el) {
    e.preventDefault();
    press(el);
    startRepeat(el);
  }
});

// Press-and-hold repeats, like a real remote's volume button.
const REPEATABLE = new Set(['volume_up', 'volume_down', 'up', 'down', 'left', 'right', 'channel_up', 'channel_down', 'rewind', 'forward']);
let repeatTimer, repeatInterval;

function startRepeat(el) {
  if (!REPEATABLE.has(el.dataset.key)) return;
  stopRepeat();
  repeatTimer = setTimeout(() => {
    repeatInterval = setInterval(() => press(el), 220);
  }, 500);
}

function stopRepeat() {
  clearTimeout(repeatTimer);
  clearInterval(repeatInterval);
}

for (const evt of ['pointerup', 'pointercancel', 'pointerleave']) {
  document.addEventListener(evt, stopRepeat);
}

// Physical keyboard, for when the phone is also lost.
document.addEventListener('keydown', (e) => {
  const map = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Enter: 'ok', Escape: 'back', Backspace: 'back',
    '+': 'volume_up', '-': 'volume_down', m: 'mute', ' ': 'play_pause',
  };
  const key = map[e.key];
  if (!key || e.target.tagName === 'INPUT') return;
  e.preventDefault();
  const el = document.querySelector(`[data-key="${key}"]`);
  if (el) press(el);
});

/* ---------------- panels ---------------- */

function togglePanel(id, onOpen) {
  const el = $(id);
  const opening = el.hidden;
  for (const other of ['numpad', 'apps', 'keyboard']) $(other).hidden = true;
  el.hidden = !opening;
  if (opening) {
    onOpen?.();
    // These panels sit below the fold on a phone; bring them up rather than
    // making the user guess that something appeared.
    requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'end' }));
  }
}

$('toggleNumpad').addEventListener('click', () => togglePanel('numpad'));
$('toggleKeyboard').addEventListener('click', () => togglePanel('keyboard', () => $('textInput').focus()));

$('toggleApps').addEventListener('click', () => togglePanel('apps', async () => {
  const box = $('apps');
  box.innerHTML = '<p style="color:var(--muted);font-size:14px">Loading…</p>';
  try {
    const apps = await api(`/devices/${encodeURIComponent(state.current.id)}/apps`);
    box.innerHTML = apps.map((a) => `<button class="app" data-app="${escapeHtml(a.id)}">${escapeHtml(a.name)}</button>`).join('')
      || '<p style="color:var(--muted);font-size:14px">No apps reported.</p>';
    box.querySelectorAll('.app').forEach((el) => el.addEventListener('click', async () => {
      buzz();
      try {
        await api(`/devices/${encodeURIComponent(state.current.id)}/launch`, { method: 'POST', body: { appId: el.dataset.app } });
      } catch (err) { toast(err.message, true); }
    }));
  } catch (err) {
    box.innerHTML = `<p style="color:var(--danger);font-size:14px">${escapeHtml(err.message)}</p>`;
  }
}));

$('sendText').addEventListener('click', async () => {
  const input = $('textInput');
  const text = input.value;
  if (!text) return;
  try {
    await api(`/devices/${encodeURIComponent(state.current.id)}/text`, { method: 'POST', body: { text } });
    input.value = '';
    toast('Sent.');
  } catch (err) {
    toast(err.message, true);
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- boot ---------------- */

(async function init() {
  try {
    const brands = await api('/brands');
    state.brands = Object.fromEntries(brands.map((b) => [b.brand, b]));
    await refreshDevices();

    if (state.devices.length) {
      const last = localStorage.getItem('tv-remote:last');
      setCurrent(state.devices.find((d) => d.id === last) || state.devices[0]);
    } else {
      setCurrent(null);
      scan(); // nothing saved: just start looking, don't make them tap first
    }
  } catch (err) {
    toast(err.message, true);
  }
})();
