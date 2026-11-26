import { afterEach, expect, test, vi } from 'vitest';

// FM8 32b (meta MMO-FAILURE-MODES-PLAN, opus-fm2 2026-11-18): an online page holds several copies of voiceSettings.ts, and only
// the game's has a browser save environment. A copy whose saves are memory only must neither answer a read nor take a write,
// or the player's hold mode is lost: fm_proof saw the first copy answer `toggle` over the saved `hold`, so B turned voice off.
const HUB = Symbol.for('wildshard.voiceSettings');
const page = globalThis as { [HUB]?: unknown };

/** A page's localStorage, shared by every copy loaded on it. */
function storage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    clear: () => { items.clear(); },
    getItem: key => items.get(key) ?? null,
    key: index => [...items.keys()][index] ?? null,
    removeItem: key => { items.delete(key); },
    setItem: (key, value) => { items.set(key, String(value)); },
  };
}

/** One page load: a memory-only copy first (the online module's), then the game's copy with the browser's storage. */
async function load(local: Storage): Promise<typeof import('../src/client/engine/ui/voiceSettings')> {
  delete page[HUB];
  vi.resetModules();
  await import('../src/client/engine/ui/voiceSettings');
  vi.resetModules();
  const { installSaveEnvironment } = await import('../src/shared/engine/saves/environment');
  installSaveEnvironment({ storage: () => local, persistent: () => true, persist: () => Promise.resolve(true) });
  return import('../src/client/engine/ui/voiceSettings');
}

afterEach(() => { delete page[HUB]; vi.resetModules(); });

test('the saved hold mode survives a reload with a memory-only copy loaded first', async () => {
  const local = storage();
  const first = await load(local);
  expect(first.voiceSettings.read().mode, 'nothing saved yet').toBe('toggle');
  first.voiceSettings.write({ mode: 'hold' });
  const reloaded = await load(local);
  expect(reloaded.voiceSettings.read().mode, 'the game copy\'s saved pick, not the memory copy\'s default').toBe('hold');
});

test('a page whose every copy is memory only still reads and writes for the visit', async () => {
  delete page[HUB];
  vi.resetModules();
  const { voiceSettings } = await import('../src/client/engine/ui/voiceSettings');
  vi.resetModules();
  await import('../src/client/engine/ui/voiceSettings');
  expect(voiceSettings.read().mode).toBe('toggle');
  voiceSettings.write({ mode: 'hold' });
  expect(voiceSettings.read().mode).toBe('hold');
});

test('QA 11-25 row 137: the talk key comes from the bindings the game lends, so the online copy carries no app', async () => {
  delete page[HUB];
  vi.resetModules();
  const online = await import('../src/client/engine/ui/voiceSettings');
  expect(online.voiceTalkKeys(), 'before the game loads: the default').toEqual(['KeyB']);
  vi.resetModules();
  const game = await import('../src/client/engine/ui/voiceSettings');
  let talk: readonly string[] = ['KeyV'];
  game.lendVoiceTalkKeys(() => [{ action: 'use', codes: ['KeyE'] }, { action: game.VOICE_TALK, codes: talk }]);
  expect(online.voiceTalkKeys(), 'the online copy reads the game\'s rebind').toEqual(['KeyV']);
  talk = [];
  expect(online.voiceTalkKeys(), 'a cleared talk key opens nothing').toEqual([]);
});
