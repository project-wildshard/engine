import { describe, expect, it } from 'vitest';
import { liftLevelStart } from '@wildshard/format/level-start';
import type { ShardManifest } from '../shard/manifest';
import { declaredStart, type StartSource } from './declaredStart';

// ONE-FORMAT OF9b3: a declared page's spawn, loadout and audio are its product's: its sections since OF9b3, its older
// `ui/level` manifest's at the door, the discovery document's only for a product with no level manifest.
const DISCOVERY = {
  spawn: { x: 10, z: 20, yaw: 1 }, ground: {},
  loadout: { weapons: [], tools: ['tool.hoverboard'], start: ['tool.hoverboard'] },
  audio: { ambience: 'legacy', score: 'legacy', cues: { hit: 'thud' } },
} as unknown as Pick<ShardManifest, 'spawn' | 'loadout' | 'audio' | 'ground'>;
const LOADOUT = { weapons: ['weapon.crossbow'], tools: ['tool.hoverboard'], start: ['tool.hoverboard'], held: 'weapon.crossbow' };
const AUDIO = { ambience: 'forest', score: 'pine' };
const OLDER = {
  spawn: { x: 0, y: 2, z: 0, yaw: 0 },
  audio: { cues: [], ambience: null, score: 'silent' },
  items: { version: 1, rows: [], contexts: [], loadout: { primary: null, secondary: null, tools: [] } },
  manifest: { name: 'Pine', spawn: { x: 4, z: 5, yaw: 2 }, loadout: LOADOUT, audio: AUDIO, weapon: 'crossbow' },
} as unknown as StartSource;

describe('declaredStart (OF9b3)', () => {
  it('reads an older product\'s level manifest at the door', () => {
    const start = declaredStart(DISCOVERY, OLDER);
    expect(start.spawn).toEqual({ x: 4, z: 5, yaw: 2 });
    expect(start.loadout).toEqual(LOADOUT);
    expect(start.audio).toEqual({ ...DISCOVERY.audio, ...AUDIO });
  });

  it('reads the same start from a product built since OF9b3, whose manifest has none of the words', () => {
    const lifted = liftLevelStart(OLDER);
    expect(lifted.manifest).toEqual({ name: 'Pine' });
    expect(declaredStart(DISCOVERY, lifted)).toEqual(declaredStart(DISCOVERY, OLDER));
  });

  it('keeps a structure page\'s spawn height, and the discovery start for a product with no level manifest', () => {
    const built = { ...OLDER, spawn: { x: 1, y: 30, z: 2, yaw: 0 }, manifest: { name: 'Nine' } } as unknown as StartSource;
    expect(declaredStart({ ...DISCOVERY, ground: { structures: true } }, built).spawn).toEqual({ x: 1, y: 30, z: 2, yaw: 0 });
    expect(declaredStart(DISCOVERY, built).spawn).toEqual({ x: 1, z: 2, yaw: 0 });
    const bare = { ...OLDER, manifest: undefined } as unknown as StartSource;
    expect(declaredStart(DISCOVERY, bare)).toEqual({ spawn: DISCOVERY.spawn, loadout: DISCOVERY.loadout, audio: DISCOVERY.audio });
  });
});
