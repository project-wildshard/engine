import { parse } from 'valibot';
import { ReturnModulesSchema, type ReturnModuleRow } from '@wildshard/format/scriptContract';
import { hasStaticGround } from '@wildshard/engine/physics/query';
import { combatSpeedFactor } from '@wildshard/engine/player/combatMotion';
import type { SimHost } from '@wildshard/engine/sim';
import { onSimHostRestored } from '@wildshard/engine/sim/snapshot';
import type { NativeCombatFrame } from '../plugin/nativeItems';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { installNativeBodyScripts } from '../quest/nativeBodyScripts';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';

interface ProductInput { readonly product: ShardProduct; readonly assets: ReadonlyMap<string, Uint8Array> }
/** SS7: the server never loads a `view` return row; only the page runs it (timer, cue and channel, no gameplay). */
export function serverReturnRows(input: unknown): ReturnModuleRow[] {
  return parse(ReturnModulesSchema, input).filter(row => row.side !== 'view');
}
/** Retain full program admission before prepare and the original per-host module loan on install. */
export async function prepareReturns(preparation: ProductInput): Promise<(host: SimHost) => void> {
  const returns = preparation.product.has('actors/return-scripts') ? serverReturnRows(preparation.product.section('actors/return-scripts')) : [];
  if (returns.length > 0) await ReturnProgram.prepareModules(preparation.product, preparation.assets, returns);
  return host => { if (returns.length > 0) ReturnProgram.lendModules(host.scope, preparation.assets, returns); };
}
/** The original native frame observer. */
export function installCombatMotion(host: SimHost, context: { readonly combat?: NativeCombatFrame }, speed: number): void {
  if (host.scope.disposed || host.scope.disposing) throw new Error('Native capability owner has ended');
  const frame = context.combat;
  if (frame === undefined) throw new Error('Native combat motion requires its combat frame');
  const observe = (player: PlayerSim, own: NativeCombatFrame): void => {
    player.observeMotion(sample => { own.speedFactor = sample === null ? null : combatSpeedFactor(
      Math.sqrt(sample.velocityX * sample.velocityX + sample.velocityZ * sample.velocityZ), sample.grounded, sample.swimming, sample.hover, speed); });
  };
  const [first] = host.players.values(); if (first === undefined) throw new Error('Simulation host has no player');
  observe(first, frame);
  // a later player's frame is made on first read; the same id back in a room is a new body to observe
  const fed = new Map<string, PlayerSim>();
  frame.seated = (id, own) => {
    const player = host.players.get(id);
    if (player === undefined || player === first || !player.hasMotor || fed.get(id) === player) return;
    fed.set(id, player); observe(player, own);
  };
}
/** The original direct body-script admission and deferred restored-ground fence. */
export function installBodyScripts(host: SimHost, context: { readonly restoring: boolean }, preparation: ProductInput): void {
  if (host.scope.disposed || host.scope.disposing) throw new Error('Native capability owner has ended');
  const requireGround = (): void => { if (!hasStaticGround(host.physics)) throw new Error('Native body scripts require admitted ground'); };
  if (context.restoring) onSimHostRestored(host, requireGround); else requireGround();
  const sections = new Map<string, unknown>();
  for (const name of ['sim/scripts', 'sim/bodies', 'actors/moves', 'actors/strikes', 'world/targets', 'sim/runtime-plan'] as const)
    if (preparation.product.has(name)) sections.set(name, preparation.product.section(name));
  installNativeBodyScripts(host, preparation.product.shardfile, preparation.assets, context.restoring, sections);
}
