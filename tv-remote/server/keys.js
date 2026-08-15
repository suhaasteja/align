// The canonical remote vocabulary.
//
// The web UI only ever speaks these names. Each adapter translates them into
// whatever its TV actually wants (Roku strings, Samsung KEY_ codes, Vizio
// codeset/code pairs, Sony base64 IRCC blobs...). Adding a brand means adding a
// translation table, never touching the UI.

export const KEYS = [
  'power', 'power_on', 'power_off',
  'home', 'back', 'menu', 'exit', 'info', 'guide',
  'up', 'down', 'left', 'right', 'ok',
  'volume_up', 'volume_down', 'mute',
  'channel_up', 'channel_down',
  'play_pause', 'play', 'pause', 'stop', 'rewind', 'forward', 'next', 'previous',
  'input',
  'num_0', 'num_1', 'num_2', 'num_3', 'num_4',
  'num_5', 'num_6', 'num_7', 'num_8', 'num_9',
];

const KEY_SET = new Set(KEYS);

export function isKey(name) {
  return KEY_SET.has(name);
}

// Some TVs expose discrete power-on/power-off but no toggle, and some expose
// only a toggle. Adapters declare what they have; this fills in the gap so the
// UI can always just send `power`.
export function resolvePower(key, map) {
  if (key !== 'power') return key;
  if (map.power) return 'power';
  return map.power_off ? 'power_off' : key;
}
