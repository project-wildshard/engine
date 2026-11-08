/** The keepsakes' law: rewards, trophy rolls and claims over existing game and save owners. keepsakesView.ts draws. */
import { Vector3, type Object3D, type PerspectiveCamera, type Scene } from 'three';
import type { Audio } from '@wildshard/engine/audio/Audio';
import { practiceRoomState } from '@wildshard/engine/core/practiceRoomState';
import type { ModelContext, ModelDef } from '@wildshard/engine/models/model';
import type { RowBodiesView } from '@wildshard/engine/entities/RowBodies';
import type { Renderer } from '@wildshard/engine/render/renderer';
import type { QuestPlace } from '@wildshard/engine/world/interact/types';
import type { Flags } from '@wildshard/engine/world/interact/flags';
import type { WorldRegistry } from '@wildshard/engine/world/registry';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import type { CollectionKeepsakes } from '@wildshard/format/collectionDisplay';
import { curveAt } from '@wildshard/format/materials';
import type { BodyShadow } from '../cosmetics/bodyShadow';
import { ClaimedPickupRoster } from '../loot/runtime';
import { isOwnedId, isCosmetic, type Owned } from '../../../shared/game/loot/Owned';
import { wirePage } from '../shardfile/wirePage';
import { rollLoot } from '../loot/tables';
import { onCreatureDeath } from '../../../shared/game/loot/deaths';
import type { DeclaredLootEconomy } from '../../../shared/game/shard/declaredRows';
import type { ShardContext } from '../plugin/context';
import type { CollectionCatalogue, CollectionDisplay, CollectionParams } from '../models/collectionDisplay';
import { collectionLoose, keepsakeView } from './keepsakesView';

/** Existing save, world, model and effect owners lend only the capabilities the collection presenter needs. */
export interface CollectionKeepsakeHost<A extends { kind: string; variant?: string | undefined; position: Vector3 }> {
  rows: CollectionKeepsakes;
  models: Readonly<Record<string, ModelDef<CollectionParams>>>;
  loose: (model: string, trophy: string | undefined, ctx: ModelContext) => Object3D;
  progression: DeclaredLootEconomy['progression'];
  pickups: NonNullable<DeclaredLootEconomy['pickups']>;
  owner?: ShardContext;
  onDeath?: (run: (animal: A) => void, order: number) => void;
  onDrop?: (run: (animal: A, item: string) => void) => void;
  owned: Owned;
  flags: Flags;
  place: (row: QuestPlace) => { x: number; y: number; z: number; yaw: number };
  floorAt: (x: number, z: number) => number;
  rewardAt: () => Vector3 | undefined;
  sky: SkyRig;
  game: { scene: Scene; camera: PerspectiveCamera; renderer: Renderer; onUpdate: (fn: (dt: number, t: number) => void, label?: string) => void };
  player: { position: Vector3; yaw: number };
  hud: { toast: (text: string) => void };
  audio: Audio;
  music: { sting: (name: 'pickup' | 'death' | 'chunk') => void };
  swords: readonly { bladeGlow: number }[];
  body: BodyShadow | null;
  registry?: WorldRegistry | undefined;
}

/** Present keepsakes from admitted rows; old flags and Owned saves remain authoritative and load quietly. */
export function installCollectionKeepsakes<A extends { kind: string; variant?: string | undefined; position: Vector3 }>(h: CollectionKeepsakeHost<A>): {
  chime: CollectionDisplay | null; plaques: CollectionDisplay | null; drops: ClaimedPickupRoster<string>['drops'];
} {
  const { owned, progression, flags, rows } = h, scope = h.owner?.scope, view = keepsakeView(h);
  const pending: { text: string; at: number }[] = [];
  let clock = 0;
  const sync = (announce: boolean): void => {
    const state = progression.states[progression.flags.filter(flag => flags.has(flag)).length];
    if (state === undefined) throw new Error('Missing admitted reward state');
    view.chime?.setCount(state.displayCount);
    for (const reward of state.earned) {
      if (!owned.grant(reward.id) || !announce) continue;
      const last = pending[pending.length - 1]?.at ?? -Infinity;
      pending.push({ text: reward.text, at: Math.max(clock + rows.delay, last + rows.spacing) });
    }
  };
  sync(false);
  const offFlags = flags.onChange(flag => { if (flag.startsWith(rows.flags.prefix)) sync(true); });
  scope?.onDispose(offFlags);
  const apply = (): void => {
    view.dress(Object.entries(rows.trophies).map(([id, item]) => {
      if (!isOwnedId(item)) throw new Error(`Unknown collection item: ${item}`);
      return [id, owned.has(item)] as const;
    }), rows.wardrobe.map(row => {
      if (!isOwnedId(row.owned) || !isCosmetic(row.owned)) throw new Error(`Unknown collection cosmetic: ${row.owned}`);
      return { slot: row.slot, model: row.model, on: owned.worn(row.owned) };
    }));
  };
  apply(); const offOwned = owned.onChange(apply); scope?.onDispose(offOwned);
  const awarded = new Set<string>();
  const roster = new ClaimedPickupRoster<string>(h.pickups, {
    scene: h.game.scene, has: id => !awarded.has(id) && isOwnedId(id) && owned.has(id),
    model: id => { const row = rows.drops[id]; if (row === undefined) throw new Error(`Missing collection drop: ${id}`); return view.loose(row.model, row.trophy); },
    random: view.random, enter: (_id, drop) => { scope?.own(drop); },
    take: id => {
      const text = h.pickups[id]?.toast, row = rows.drops[id];
      if (!isOwnedId(id) || text === undefined || row === undefined) throw new Error(`Unknown collection pickup: ${id}`);
      awarded.delete(id); owned.grant(id); if (row.wear && isCosmetic(id)) owned.wear(id);
      view.announce(text, 0.8);
    },
  });
  h.onDeath?.(animal => {
    if (practiceRoomState.open || wirePage.client !== null) return;
    const drop = roster.death(animal, h.player.position, rollLoot('trophies', animal).map(row => row.item));
    if (drop === null) return;
    if (drop.floor === 'ground') drop.at.y = h.floorAt(drop.at.x, drop.at.z);
    roster.spawn(drop.id, drop.at, true);
  }, 30);
  h.onDrop?.((animal, item) => {
    if (!Object.hasOwn(rows.drops, item)) return;
    awarded.add(item);
    const drop = roster.death(animal, h.player.position, [item]);
    if (drop === null) { awarded.delete(item); return; }
    if (drop.floor === 'ground') drop.at.y = h.floorAt(drop.at.x, drop.at.z);
    roster.spawn(drop.id, drop.at, true);
  });
  for (const row of rows.restore) {
    const at = h.rewardAt();
    if (flags.has(row.flag) && isOwnedId(row.item) && !owned.has(row.item) && at !== undefined) roster.spawn(row.item, at, false);
  }
  h.game.onUpdate((dt, t) => {
    clock += dt;
    if (clock >= (pending[0]?.at ?? Infinity)) {
      const next = pending.shift();
      if (next !== undefined) view.announce(next.text, 0.9);
    }
    roster.update(dt, t, h.game.renderer, h.game.camera, h.player.position);
    view.glow(owned.has(progression.glow.owned) ? curveAt(progression.glow.curve, h.sky.night) : 0);
  }, 'keepsakes');
  const { chime, plaques } = view;
  h.owner?.debug.expose(rows.debugName, { chime, plaques, drops: roster.drops,
    glass: (n: number) => { for (let i = 1; i <= rows.flags.count; i++) flags.set(`${rows.flags.prefix}${i}`, i <= n); },
    drop: (id: string) => {
      const player = h.player.position, x = player.x - Math.sin(h.player.yaw) * 2.5, z = player.z - Math.cos(h.player.yaw) * 2.5;
      roster.spawn(id, new Vector3(x, h.floorAt(x, z), z), true);
    },
  });
  return { chime, plaques, drops: roster.drops };
}

/** Borrowed opaque service instances; all rules and schedules are owned by the shared host. */
export interface CollectionKeepers<P extends object> {
  adventure: { flags: Flags; place: CollectionKeepsakeHost<never>['place']; floorAt: (x: number, z: number) => number;
    finale: { rewardAt: Vector3 } | null };
  world: { game: Omit<CollectionKeepsakeHost<never>['game'], 'onUpdate'>; sky: SkyRig;
    player: CollectionKeepsakeHost<never>['player']; registry: WorldRegistry };
  play: { owned: Owned; hud: CollectionKeepsakeHost<never>['hud']; audio: Audio; music: CollectionKeepsakeHost<never>['music'];
    bodyShadow?: BodyShadow | null; animals: RowBodiesView };
  swords: CollectionKeepsakeHost<never>['swords'];
  catalogue: CollectionCatalogue;
  models: ReadonlyMap<string, ModelDef<P>>;
}

/** Game.scene is a prototype accessor, so spreading a Game silently drops it.
 * Borrow the ports explicitly while the scoped host supplies the update owner. */
export function collectionGamePorts(game: CollectionKeepers<object>['world']['game'],
  onUpdate: CollectionKeepsakeHost<never>['game']['onUpdate']): CollectionKeepsakeHost<never>['game'] {
  return { scene: game.scene, camera: game.camera, renderer: game.renderer, onUpdate };
}

/** Bind existing world/adventure/player instances from rows; their legacy capability borrow is tracked by G482. */
export async function installDeclaredCollectionKeepsakes<P extends object>(ctx: ShardContext, rows: CollectionKeepsakes, economy: DeclaredLootEconomy,
  owners: ReadonlyMap<string, CollectionKeepers<P>>): Promise<void> {
  const owner = owners.get('collection'); if (owner === undefined) throw new Error('Missing collection owners');
  await owner.catalogue.prepare(); if (ctx.scope.disposed) return;
  const { world, play, adventure } = owner;
  installCollectionKeepsakes({ rows, models: owner.catalogue.models, owner: ctx,
    progression: economy.progression, pickups: economy.pickups ?? {}, flags: adventure.flags,
    place: row => adventure.place(row), floorAt: (x, z) => adventure.floorAt(x, z), rewardAt: () => adventure.finale?.rewardAt,
    owned: play.owned, sky: world.sky, player: world.player, hud: play.hud, audio: play.audio, music: play.music,
    body: play.bodyShadow ?? null, swords: owner.swords, registry: world.registry,
    onDrop: run => { ctx.on('reward.granted', ({ body, item }) => { if (item === undefined) return; const animal = play.animals.animals.find(candidate => candidate.entityId === body); if (animal !== undefined) run(animal, item); }); },
    onDeath: (run, order) => { onCreatureDeath(ctx, () => play.animals.animals, run, order); },
    loose: collectionLoose(owner),
    game: collectionGamePorts(world.game, run => { ctx.system({ id: 'keepsakes', phase: 'update', after: ['game.loot', 'body-shadow'],
      before: ['hud.combat', 'last place', 'first hints', 'main.world'], run }); }),
  });
}
