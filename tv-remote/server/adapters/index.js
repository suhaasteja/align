import * as roku from './roku.js';
import * as samsung from './samsung.js';
import * as lg from './lg.js';
import * as vizio from './vizio.js';
import * as sony from './sony.js';

// Probe order matters a little: Roku is the cheapest and most decisive check,
// Sony's is the loosest, so it goes last.
export const all = [roku, samsung, lg, vizio, sony];

export const byBrand = Object.fromEntries(all.map((a) => [a.brand, a]));

export function get(brand) {
  const adapter = byBrand[brand];
  if (!adapter) throw new Error(`unknown brand "${brand}"`);
  return adapter;
}

export function describe() {
  return all.map((a) => ({
    brand: a.brand,
    label: a.label,
    needsPairing: a.needsPairing,
    pairingKind: a.pairingKind || null,
    features: a.features || {},
    // Lets the UI grey out buttons this brand genuinely cannot do, instead of
    // offering them and failing on press.
    keys: a.supportedKeys || [],
  }));
}
