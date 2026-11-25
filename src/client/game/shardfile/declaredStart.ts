import { DEFAULT_SPAWN, levelStart } from '@wildshard/format/level-start';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { bindAudioCatalogue, type ShardManifest } from '../shard/manifest';

type StartManifest = Pick<ShardManifest, 'spawn' | 'loadout' | 'audio' | 'ground'>;
/** what a declared page's start is read from: its sections, and (a product built before OF9b3) its `ui/level` manifest */
export type StartSource = Pick<Shardfile, 'spawn' | 'audio' | 'items' | 'manifest'>;

/**
 * ONE-FORMAT OF9b3: where a declared page stands its player, what it arms and what it plays. A product built since OF9b3
 * keeps them in its sections (`world/spawn`, `items.loadout.level`, `audio.level`) and its `ui/level` manifest has none;
 * an older product's manifest still carries them and they are read at the door (format `levelStart`). The start is the
 * product's own, as the level look is (`declaredLevel`), so a page stands where its product says even when the discovery
 * document is older or newer, or (since OF9b5) carries none. FORMAT-PRUNE FP35: a product with no level manifest (the
 * open plots, Mirror Salt, Mossgate) stands where its `world/spawn` says too, the discovery's spawn only when the product
 * never declared one; its loadout and audio are its sections' when it has them, else the discovery's.
 * A spawn on terrain has no height: the page stands the player on the ground (`manifest.ground.structures` keeps it).
 */
export function declaredStart(manifest: StartManifest, source: StartSource): Pick<ShardManifest, 'spawn'> & Pick<Partial<ShardManifest>, 'loadout' | 'audio'> {
  const undeclared = source.manifest === undefined && sameSpawn(source.spawn, DEFAULT_SPAWN);
  const level = undeclared ? { spawn: manifest.spawn } : source.manifest;
  const start = levelStart({ spawn: source.spawn, audio: source.audio, items: source.items, ...(level === undefined ? {} : { manifest: level }) }, manifest.ground.structures === undefined);
  const loadout = start.loadout ?? manifest.loadout;
  // the discovery's audio bindings (cues, preload) stay; the product's own words lie over them
  const audio = start.audio === undefined ? manifest.audio : { ...manifest.audio, ...start.audio };
  return { spawn: start.spawn, ...(loadout === undefined ? {} : { loadout }), ...(audio === undefined ? {} : { audio }) };
}

function sameSpawn(a: StartSource['spawn'], b: StartSource['spawn']): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z && a.yaw === b.yaw;
}

/** FORMAT-PRUNE FP54: a declared page's start is its product's (`audio.level`), which may name the folder catalogue over a
 *  discovery document with no audio; it binds the catalogue's preload and boot inventory as the discovery reader does, so the
 *  world builds its mixer before kit's audio entry. */
export function catalogueBound(page: ShardManifest): ShardManifest {
  if (page.audio === undefined) return page;
  const { audio, boot } = bindAudioCatalogue(page.slug, page.audio, page.boot);
  return audio === page.audio ? page : { ...page, audio, ...(boot === undefined ? {} : { boot }) };
}

/** FORMAT-PRUNE FP54: a runtime page (a discovery naming its client-plan entry) stands, arms and plays as its product says, as
 *  a declared page does: its discovery since OF9b5 carries no start, so the page took the old engine default audio and spawn. */
export function productStart<M extends ShardManifest>(manifest: M, source: StartSource): M {
  return catalogueBound({ ...manifest, ...declaredStart(manifest, source) }) as M;
}
