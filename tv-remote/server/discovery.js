// Finding the TV.
//
// Two strategies, run together:
//
//   1. SSDP — shout on the multicast address and collect whatever answers.
//      Fast and cheap, but plenty of TVs ignore it or reply only to specific
//      search targets, and some routers block multicast between wireless
//      clients entirely.
//   2. Subnet sweep — probe every address on the local /24 with each adapter's
//      own fingerprint. Slower but it finds things SSDP misses.
//
// Both feed the same probe functions, so a TV found twice collapses into one
// entry keyed by brand+ip.

import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';
import * as adapters from './adapters/index.js';
import { deviceId } from './store.js';

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;

export function localAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address, netmask: a.netmask });
    }
  }
  return out;
}

function subnetHosts(address, netmask) {
  // Only /24 and smaller are worth sweeping; anything wider is too many probes.
  const maskBits = netmask.split('.').reduce((n, o) => n + ((Number(o) >>> 0).toString(2).match(/1/g) || []).length, 0);
  if (maskBits < 24) return [];
  const parts = address.split('.').map(Number);
  const hosts = [];
  for (let i = 1; i < 255; i++) {
    if (i === parts[3]) continue;
    hosts.push(`${parts[0]}.${parts[1]}.${parts[2]}.${i}`);
  }
  return hosts;
}

function ssdpSearch({ timeout = 3000 } = {}) {
  return new Promise((resolve) => {
    const found = new Set();
    let socket;
    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch {
      return resolve([]);
    }

    socket.on('message', (msg, rinfo) => {
      const text = msg.toString();
      // We only need the address — the adapters fingerprint it properly after.
      if (/roku|samsung|lg|vizio|sony|MediaRenderer|dial-multiscreen/i.test(text)) found.add(rinfo.address);
    });
    socket.on('error', () => {});

    socket.bind(() => {
      try { socket.setBroadcast(true); } catch {}
      const targets = ['roku:ecp', 'ssdp:all', 'urn:dial-multiscreen-org:service:dial:1'];
      for (const st of targets) {
        const payload = Buffer.from(
          `M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDR}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nST: ${st}\r\nMX: 2\r\n\r\n`
        );
        socket.send(payload, 0, payload.length, SSDP_PORT, SSDP_ADDR, () => {});
      }
      setTimeout(() => {
        try { socket.close(); } catch {}
        resolve([...found]);
      }, timeout);
    });
  });
}

// Run `worker` over `items` with bounded concurrency — a 254-host sweep times
// four adapters would otherwise open a thousand sockets at once.
async function pooled(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      const r = await worker(item);
      if (r) results.push(r);
    }
  });
  await Promise.all(runners);
  return results;
}

async function probeHost(ip, { timeout }) {
  for (const adapter of adapters.all) {
    try {
      const found = await adapter.probe(ip, { timeout });
      if (found) return { ...found, id: deviceId(found.brand, found.ip) };
    } catch {
      // adapter said no; try the next
    }
  }
  return null;
}

export async function discover({ sweep = true, timeout = 1200, onProgress } = {}) {
  const byId = new Map();
  const add = (d) => { if (d && !byId.has(d.id)) byId.set(d.id, d); };

  // SSDP first — anything it turns up is confirmed within a second or two.
  const hinted = await ssdpSearch({ timeout: 2500 });
  onProgress?.({ phase: 'ssdp', found: hinted.length });
  const hintedDevices = await pooled(hinted, 8, (ip) => probeHost(ip, { timeout: 2500 }));
  hintedDevices.forEach(add);

  if (!sweep) return [...byId.values()];

  // Then sweep whatever SSDP didn't already account for.
  const seen = new Set([...byId.values()].map((d) => d.ip));
  const hosts = localAddresses()
    .flatMap((iface) => subnetHosts(iface.address, iface.netmask))
    .filter((ip) => !seen.has(ip));

  onProgress?.({ phase: 'sweep', total: hosts.length });
  let done = 0;
  const swept = await pooled(hosts, 40, async (ip) => {
    const r = await probeHost(ip, { timeout });
    if (++done % 25 === 0) onProgress?.({ phase: 'sweep', done, total: hosts.length });
    return r;
  });
  swept.forEach(add);

  return [...byId.values()];
}
