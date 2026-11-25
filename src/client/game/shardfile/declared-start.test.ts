import { describe, expect, it } from 'vitest';
import { liftLevelStart } from '@wildshard/format/level-start';
import { UNSET_LEVEL_AUDIO, type ShardManifest } from '../shard/manifest';
import { catalogueBound, declaredStart, productStart, type StartSource } from './declaredStart';

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

  it('stands a product with no level manifest where its world/spawn says, its sections over the discovery (FP35)', () => {
    const plot = { ...OLDER, manifest: undefined, spawn: { x: 0, y: 0.1, z: -45, yaw: 3 } } as unknown as StartSource;
    const structures = { ...DISCOVERY, ground: { structures: true as const } };
    expect(declaredStart(structures, plot)).toEqual({ spawn: { x: 0, y: 0.1, z: -45, yaw: 3 }, loadout: DISCOVERY.loadout, audio: DISCOVERY.audio });
    expect(declaredStart(DISCOVERY, plot).spawn).toEqual({ x: 0, z: -45, yaw: 3 });
    const sections = { ...plot, items: { ...OLDER.items, loadout: { ...OLDER.items.loadout, level: LOADOUT } }, audio: { ...OLDER.audio, level: AUDIO } } as unknown as StartSource;
    expect(declaredStart(structures, sections)).toEqual({ spawn: { x: 0, y: 0.1, z: -45, yaw: 3 }, loadout: LOADOUT, audio: { ...DISCOVERY.audio, ...AUDIO } });
  });

  // FORMAT-PRUNE FP54: Pine 0.1.0.6 keeps `audio.level` (`catalogue: true`) in its sections and its discovery carries no audio;
  // the page took the word with no preload, so the world built no mixer and kit's audio entry refused ("requires its native mixer").
  it('binds the folder catalogue a product names over a discovery with no audio (FP54)', () => {
    const level = { ambience: 'ambience.pine', bed: 'forest', catalogue: true, score: 'score.pine' };
    const built = { ...liftLevelStart(OLDER), audio: { ...OLDER.audio, level } } as unknown as StartSource;
    const discovery = { ...DISCOVERY, audio: UNSET_LEVEL_AUDIO };
    const start = declaredStart(discovery, built);
    expect(start.audio).toMatchObject({ catalogue: true });
    expect(start.audio?.preload).toBeUndefined();
    const page = catalogueBound({ ...discovery, ...start, slug: 'pine-hollow', boot: { files: [] } } as unknown as ShardManifest);
    expect(page.audio).toEqual({ ambience: 'ambience.pine', bed: 'forest', score: 'score.pine', preload: expect.any(Function) });
    expect(page.audio).not.toHaveProperty('catalogue');
    expect(page.boot?.audio).toEqual(expect.any(Function));
  });

  it('keeps a discovery\'s bound preload and boot audio, and leaves a page with no catalogue as it was (FP54)', () => {
    const preload = (): Promise<never> => Promise.reject(new Error('unused')), files = (): Promise<string[]> => Promise.resolve([]);
    const bound = { slug: 'pine-hollow', audio: { ambience: 'a', score: 's', preload, catalogue: true }, boot: { audio: files } } as unknown as ShardManifest;
    const page = catalogueBound(bound);
    expect(page.audio?.preload).toBe(preload);
    expect(page.boot?.audio).toBe(files);
    const plain = { slug: 'nine', audio: { ambience: 'a', score: 's' } } as unknown as ShardManifest;
    expect(catalogueBound(plain)).toBe(plain);
  });

  it('stands a runtime page where its product says and binds its catalogue, over a discovery with no start (FP54)', () => {
    const level = { ambience: 'ambience.pine', bed: 'forest', catalogue: true, score: 'score.pine' };
    const pine = { ...liftLevelStart(OLDER), spawn: { x: 0, y: 0, z: -235, yaw: Math.PI }, audio: { ...OLDER.audio, level } } as unknown as StartSource;
    const discovery = { ...DISCOVERY, slug: 'pine-hollow', spawn: { x: 0, z: 0, yaw: 0 }, audio: UNSET_LEVEL_AUDIO, boot: { files: [] }, clientPlanRuntime: true } as unknown as ShardManifest;
    const page = productStart(discovery, pine);
    expect(page.spawn).toEqual({ x: 0, z: -235, yaw: Math.PI });
    expect(page.loadout).toEqual(LOADOUT);
    expect(page.audio).toEqual({ ambience: 'ambience.pine', bed: 'forest', score: 'score.pine', preload: expect.any(Function) });
    expect(typeof page.boot?.audio).toBe('function');
    expect(page.clientPlanRuntime).toBe(true);
  });
});
