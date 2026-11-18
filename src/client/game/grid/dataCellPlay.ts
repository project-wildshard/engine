// SHARD-SOURCE SS-GP7: a grid data cell's side of the one install list (`shardfile/playInstalls.ts`). While the feet stand in
// the copy every entry its source wants installs on a port whose wire reads and sends only while the wire is this cell's;
// its systems are named for the cell, and all of it leaves with the stay. Replaces the per-feature grid installs of the race
// clock (SS-MS1b), the talks (TC-E8), the steer ride (SS-MS2a3b) and a held tool's lines (the kit's, 0601e1ac).
import { Group } from 'three';
import type { ItemRuntime } from '@wildshard/engine/combat/items';
import type { Scope } from '@wildshard/engine/app/scope';
import { app } from '@wildshard/engine/app/runtime';
import { NET_BUTTONS } from '@wildshard/engine/input/netButtons';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { FollowedMovers } from '../plugin/followedMovers';
import { PLAY_INSTALLS, installPlay, playWire, type PlayPort, type PlayViews } from '../shardfile/playInstalls';
import { wirePage } from '../shardfile/wirePage';
import type { RegionalRuntimePage } from './regionalRuntime';

const unset = (what: string) => (): never => { throw new Error(`grid play port: no ${what}`); };

/** A grid stay's play port: the wire gated on `here`, the cell server's flags, and `parts` for the page's owners. */
export function cellPlayPort(stay: Scope, here: () => boolean,
  parts: Partial<Omit<PlayPort, 'scope' | 'line' | 'tick' | 'led' | 'send' | 'live' | 'views'>> & { readonly views?: Partial<PlayViews> }): PlayPort {
  return { ...playWire(here), scope: stay, system: unset('frame clock'), flags: wirePage.gates, prompts: [], root: new Group(),
    feet: unset('player'), rider: { yaw: 0, position: { x: 0, y: 0, z: 0 } }, boost: () => false, movers: null, items: () => null,
    ...parts, views: { raceClock: unset('race chip'), steer: unset('steer chip'), talkBox: unset('talk box'), ...parts.views } };
}

/** What a stay's install borrows from the session: the copy's prompts, its movers, and the entered kit's items. */
export interface DataCellPlayParts {
  readonly prompts: Interactable[];
  readonly movers: FollowedMovers | null;
  readonly items: () => ReadonlyMap<string, ItemRuntime> | null;
}

/** The port a stay's entries install on: the page's player and the session's parts, its frame systems named for the cell. */
export function cellPagePort(page: Pick<RegionalRuntimePage, 'world'>, stay: Scope, instance: string, here: () => boolean, parts: DataCellPlayParts,
  views: PlayViews): PlayPort {
  const player = page.world.player;
  return cellPlayPort(stay, here, { ...parts, views,
    system: (spec) => { app.addSystem({ ...spec, id: `grid.${instance}.${spec.id}` }, stay); },
    feet: () => player.position, rider: player, boost: () => (player.sampleHeldCommand().buttons & NET_BUTTONS.sprint) !== 0 });
}

/** The page's install: every entry the copy wants on `cellPagePort`, its chips and box loaded with the quest presentation;
 *  the ids installed. */
export async function enterDataCellPlay(source: Shardfile, page: Pick<RegionalRuntimePage, 'world'>, stay: Scope, instance: string, here: () => boolean,
  parts: DataCellPlayParts): Promise<string[]> {
  if (!PLAY_INSTALLS.some(entry => entry.wants(source))) return [];
  const [chips, ui] = await Promise.all([import('@wildshard/engine/quest/view/ui'), import('../plugin/ui')]);
  if (stay.disposed || stay.disposing) return [];
  return installPlay(source, cellPagePort(page, stay, instance, here, parts,
    { raceClock: () => new chips.RaceClockChip(stay), steer: () => new chips.SteerChip(stay), talkBox: () => ui.talkBox(stay.child('talks')) }));
}
