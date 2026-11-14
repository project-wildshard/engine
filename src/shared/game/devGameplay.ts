import { parseShardfile, type Shardfile } from '@wildshard/format/shardSchema';
import { carryOutputDescriptor } from '@wildshard/engine/game/shardfile/outputDescriptor';

/**
 * SHARD-SOURCE AP19 (J347): `wildshard watch`'s soft restart. A watched shard's quests, encounters, spawns or scripts
 * changed: the in-page server restarts its world on the new sections, from a save it takes first (so progress and the
 * player's place carry over), and the page rebuilds its quest views. These are the sections it takes; anything else (the
 * state schema, the look, the ground) is a new shell or the hook's other calls. DEVSERVER-only on both sides, as
 * `devColliders.ts` is (engine `scripts/check-devserver.mjs` refuses `wildshardDevRestart` in a production bundle).
 */
// `questNpcs` and `clientScripts` are not here: only the page reads them and the hook rebuilds only the quest views, so a change
// to either is a new shell.
export const DEV_GAMEPLAY_SECTIONS = ['quests', 'questHost', 'encounters', 'directors', 'creatures', 'crowds', 'hooks', 'ledger', 'sim'] as const;
export type DevGameplaySection = typeof DEV_GAMEPLAY_SECTIONS[number];
/** The new rows of each section the watched source declares now; a section left out keeps the shell's. */
export type DevGameplay = Partial<Pick<Shardfile, DevGameplaySection>>;
/** Where the page's player stands: the restarted world puts its player there. */
export interface DevPlace { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }
/** The harness-port message that restarts the in-page server; its ports are the new game link and the reply's. */
export interface DevRestartMessage { readonly wildshardDevRestart: DevGameplay; readonly at: DevPlace | null }
/** The worker's answer on the reply port. */
export interface DevRestarted { readonly ok: boolean; readonly ms: number; readonly reason?: string }

const SECTIONS: ReadonlySet<string> = new Set(DEV_GAMEPLAY_SECTIONS);

export const isDevRestart = (value: unknown): value is DevRestartMessage => {
  if (typeof value !== 'object' || value === null || !('wildshardDevRestart' in value) || !('at' in value)) return false;
  const { wildshardDevRestart: gameplay, at } = value;
  if (typeof gameplay !== 'object' || gameplay === null || Array.isArray(gameplay) || !Object.keys(gameplay).every(key => SECTIONS.has(key))) return false;
  return at === null || (typeof at === 'object' && 'x' in at && 'y' in at && 'z' in at && 'yaw' in at && [at.x, at.y, at.z, at.yaw].every(n => typeof n === 'number' && Number.isFinite(n)));
};

/** `shard` with `gameplay`'s sections in place of its own, checked as a whole shardfile; the output descriptor carries over. */
export function withDevGameplay(shard: Shardfile, gameplay: DevGameplay): Shardfile {
  const merged: Record<string, unknown> = { ...shard };
  for (const section of DEV_GAMEPLAY_SECTIONS) if (gameplay[section] !== undefined) merged[section] = gameplay[section];
  // oxlint-disable-next-line unicorn/prefer-structured-clone -- JSON wire normalization, as the product reader parses it
  const next = parseShardfile(JSON.parse(JSON.stringify(merged)));
  carryOutputDescriptor(shard, next);
  return next;
}
