import { saveFixtureCode } from './debug-settings.mjs';

/** Browser init: remove every persisted Debug override, without touching play saves.
 * Missing choices then take their registered defaults, including shard-local rows.
 * Storage errors refuse the measurement instead of silently reusing an old pick. */
export function resetFrameFloorDebug() {
  for (const scope of ['global', 'device', 'session']) {
    const storage = scope === 'session' ? sessionStorage : localStorage;
    const name = `wildshard.save.v2.${scope}`;
    /** @type {{keys?: Record<string, unknown>}} */
    const document = JSON.parse(storage.getItem(name) ?? '{"keys":{}}');
    const keys = document.keys ?? {};
    for (const key of Object.keys(keys)) if (key.startsWith('debug.') || scope === 'global' && key === 'settings') delete keys[key];
    storage.setItem(name, JSON.stringify({ ...document, keys }));
  }
}

/** Exactly one run's picks; never merge Safari's preceding A/B configuration.
 * @param {Record<string, string>} settings */
export function frameFloorSettingsCode(settings) {
  return `(${resetFrameFloorDebug.toString()})();${saveFixtureCode({ scope: 'global', key: 'settings', data: settings })}`;
}

/** Read back the preparation document before any game import. Fixture writes
 * may be unavailable in Safari's JSON viewer; accepting their evaluation result
 * does not prove that the game origin received its settings.
 * @param {Record<string, string>} settings
 * @param {boolean} developer
 * @param {Record<string, string>} deviceSaves */
export function assertFrameFloorFixture(settings, developer, deviceSaves) {
  const global = JSON.parse(localStorage.getItem('wildshard.save.v2.global') ?? '{}');
  const device = JSON.parse(localStorage.getItem('wildshard.save.v2.device') ?? '{}');
  if (Object.entries(settings).some(([key, value]) => global.keys?.settings?.data?.[key] !== value)
    || device.keys?.devMode?.data !== developer
    || Object.entries(deviceSaves).some(([key, value]) => device.keys?.[key]?.data !== value)) {
    throw new Error('Frame-floor preparation did not retain its settings/device fixtures');
  }
}

/** A real same-origin HTML document owns Safari's cold fixture writes, rather
 * than the JSON viewer. It loads no game module or measurement window.
 * @param {string} fixture
 * @param {string} check */
export function frameFloorBootstrapHtml(fixture, check) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Frame-floor preparation</title><script>${fixture};${check};window.__frameFloorBootstrapReady=true;</script></head><body>Frame-floor preparation</body></html>`;
}

/** Keep Safari's prepared storage context when entering the game. The boot
 * trace lost fixture writes after a second native openurl, while same-tab
 * navigation retained them. Acknowledge the Inspector evaluation first, then
 * reconnect to the exact game URL; this runs before any measurement window.
 * @param {string} url */
export function frameFloorGameNavigationCode(url) {
  return `(() => { setTimeout(() => location.replace(${JSON.stringify(url)}), 100); return true; })()`;
}

/** Bounded pre-measurement fixture provenance. Observe only the two fixture
 * documents, never player payloads; restore native methods before sampling. */
export function traceFrameFloorFixtureWrites() {
  const proto = Storage.prototype;
  const get = Object.getOwnPropertyDescriptor(proto, 'getItem');
  const set = Object.getOwnPropertyDescriptor(proto, 'setItem');
  const remove = Object.getOwnPropertyDescriptor(proto, 'removeItem');
  const clear = Object.getOwnPropertyDescriptor(proto, 'clear');
  if (!get || !set || !remove || !clear) throw new Error('Native Storage methods are unavailable');
  const rows = [];
  let lastState = '';
  const snapshot = () => {
    try {
      const global = JSON.parse(Reflect.apply(get.value, localStorage, ['wildshard.save.v2.global']) ?? '{}');
      const device = JSON.parse(Reflect.apply(get.value, localStorage, ['wildshard.save.v2.device']) ?? '{}');
      return { settings: global.keys?.settings !== undefined, gfx: global.keys?.gfx !== undefined,
        developer: device.keys?.devMode !== undefined };
    } catch { return { unavailable: true }; }
  };
  const record = (operation, key, sourcePath = '') => {
    const state = snapshot(); lastState = JSON.stringify(state);
    if (rows.length < 64) rows.push({ operation, key, sourcePath, at: performance.now(), state, stack: new Error('Fixture storage transition').stack?.slice(0, 1600) ?? '' });
  };
  const named = key => key === 'wildshard.save.v2.global' || key === 'wildshard.save.v2.device';
  const getWrapper = function getWrapper(...args) {
    const result = Reflect.apply(get.value, this, args);
    if (this === localStorage && named(args[0]) && JSON.stringify(snapshot()) !== lastState) record('getItem-transition', args[0]);
    return result;
  };
  const setWrapper = function setWrapper(...args) {
    Reflect.apply(set.value, this, args);
    if (this === localStorage && named(args[0])) record('setItem', args[0]);
  };
  const removeWrapper = function removeWrapper(...args) {
    Reflect.apply(remove.value, this, args);
    if (this === localStorage && named(args[0])) record('removeItem', args[0]);
  };
  const clearWrapper = function clearWrapper(...args) {
    Reflect.apply(clear.value, this, args);
    if (this === localStorage) record('clear', '*');
  };
  const storageEvent = event => {
    if (event.storageArea !== localStorage || event.key !== null && !named(event.key)) return;
    let sourcePath = '';
    try { sourcePath = new URL(event.url).pathname; } catch { /* missing event origin stays unknown */ }
    record('storage-event', event.key, sourcePath);
  };
  proto.getItem = getWrapper; proto.setItem = setWrapper; proto.removeItem = removeWrapper; proto.clear = clearWrapper;
  window.addEventListener?.('storage', storageEvent);
  record('before-fixture', '');
  Reflect.set(window, '__frameFloorFixtureWrites', {
    finish: () => {
      window.removeEventListener?.('storage', storageEvent);
      if (Object.getOwnPropertyDescriptor(proto, 'getItem')?.value === getWrapper) Object.defineProperty(proto, 'getItem', get);
      if (Object.getOwnPropertyDescriptor(proto, 'setItem')?.value === setWrapper) Object.defineProperty(proto, 'setItem', set);
      if (Object.getOwnPropertyDescriptor(proto, 'removeItem')?.value === removeWrapper) Object.defineProperty(proto, 'removeItem', remove);
      if (Object.getOwnPropertyDescriptor(proto, 'clear')?.value === clearWrapper) Object.defineProperty(proto, 'clear', clear);
      return { rows, final: snapshot(), restored: Object.getOwnPropertyDescriptor(proto, 'getItem')?.value === get.value && Object.getOwnPropertyDescriptor(proto, 'setItem')?.value === set.value
        && Object.getOwnPropertyDescriptor(proto, 'removeItem')?.value === remove.value && Object.getOwnPropertyDescriptor(proto, 'clear')?.value === clear.value };
    },
  });
}
