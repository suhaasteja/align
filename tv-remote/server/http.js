// Small fetch wrappers.
//
// Two things the built-in fetch won't do for us: bail out fast on a dead IP
// (important — discovery probes a whole /24), and talk to a TV whose HTTPS cert
// is self-signed (Samsung and Vizio both are). The Undici Agent handles the
// latter without turning off TLS verification process-wide.

import { Agent } from 'undici';

export class TimeoutError extends Error {}

// Scoped to TV control traffic only. This is the accepted trade-off for local
// smart-TV APIs: they ship self-signed certs with no way to install a CA.
const insecureAgent = new Agent({
  connect: { rejectUnauthorized: false },
});

export async function httpRaw(url, { timeout = 5000, insecure = false, ...init } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      ...(insecure || url.startsWith('https:') ? { dispatcher: insecureAgent } : {}),
    });
    return res;
  } catch (err) {
    if (err?.name === 'AbortError') throw new TimeoutError(`timed out after ${timeout}ms: ${url}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function httpText(url, opts = {}) {
  const res = await httpRaw(url, opts);
  const body = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} from ${url}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export async function httpJson(url, opts = {}) {
  const res = await httpRaw(url, opts);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`expected JSON from ${url}, got: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} from ${url}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}
