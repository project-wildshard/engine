/** The arena room's sim half (P1-E4.2): its row-driven fight and the brain each body runs, over whichever host lends its
 *  body, players and room (`ArenaFightPorts`): the page, or a SimHost's every player (arenaRoomNative.ts). Its looks are the
 *  view half's (arenaRoomView.ts `arenaRoomViews`), passed in; nothing here draws. */
import { Vector3 } from 'three';
import * as v from 'valibot';
import type { BossScript } from '@wildshard/engine/ai/BossBrain';
import { canReach, type ReachActor } from '@wildshard/engine/ai/reach';
import { strikeFromData } from '@wildshard/engine/ai/strikeRows';
import { StrikeRunner, type StrikeContext } from '@wildshard/engine/ai/strikes';
import type { CombatPipeline, DamageRequest } from '@wildshard/engine/combat/pipeline';
import type { Physics } from '@wildshard/engine/physics/Physics';
import type { SpeciesDef } from '@wildshard/engine/entities/species/registry';
import { parseBossProfile } from '@wildshard/format/bossProfiles';
import { ArenaRoomSpeciesControlSchema } from '@wildshard/format/speciesBookRows';
import type { BoundedArenaFight } from '../../../shared/game/boss/arenaRoomRows';
import { bossFight, type BossViewBinding, type PhasedBossBody, type PhasedBossBrain, type PhasedBossFight, type PhasedBossPorts } from '../plugin/bossPhase';

/** The body of an arena fight, the page's or a host's: what the strike rows and the reach test read of it. */
export type ArenaFightBody = PhasedBossBody & StrikeContext['actor'] & ReachActor & { readonly kind: string; readonly label: string };
/** Built-in body binding for row-driven arena fights. Species adapters observe
 * the shared fight's brain rather than installing a shard decision owner. */
type SpeciesBody = Parameters<NonNullable<SpeciesDef['think']>>[0];
const arenaBrains = new WeakMap<object, PhasedBossBrain<SpeciesBody>>();
export function arenaRoomBrain(actor: SpeciesBody): PhasedBossBrain<SpeciesBody> | undefined { return arenaBrains.get(actor); }
/** Hand a body its fight's brain, for the species' forwards. */
export function bindArenaBrain(actor: SpeciesBody, brain: PhasedBossBrain<SpeciesBody>): void { arenaBrains.set(actor, brain); }

/** Row-selected controls over the original arena brain; no other fight/body
 * owner is installed. Nullish defaults retain authored order and lazy height. */
export function arenaRoomSpeciesControl(input:unknown):Pick<SpeciesDef,'think'|'act'|'damageMul'>{
  const rows=v.parse(ArenaRoomSpeciesControlSchema,input),initial=rows.initialize;
  if(new Set(initial.defaults.map(row=>row.field)).size!==initial.defaults.length
    ||initial.defaults.some(row=>row.field===initial.flag))throw new Error('Invalid arena species initialization');
  return{
    think:(actor,context)=>{
      const memory=actor.mem;
      if(memory[initial.flag]!==1){memory[initial.flag]=1;
        for(const row of initial.defaults)memory[row.field]??=row.source==='height'?context.heightAt(actor.position.x,actor.position.z):row.value;
      }
      arenaRoomBrain(actor)?.think(actor,context);
    },
    act:(actor,context)=>{arenaRoomBrain(actor)?.act(actor,context);},
    damageMul:(actor,point)=>arenaRoomBrain(actor)?.damageMul(actor,point)??1,
  };
}

/** The fight's world from wherever it runs. `target` is whom the fight deals with right now; a lone player always. */
export interface ArenaFightTarget {
  readonly position: Vector3; readonly dash: (x: number, z: number, seconds: number) => void;
  /** The target's health in the combat pipeline; null: nobody to hurt yet. */
  readonly health: DamageRequest['target'] | null;
}
export interface ArenaFightPorts<A extends ArenaFightBody> {
  /** The walkable room the fight piles, drains and seals. */
  readonly room: { readonly floorHeightAt: (x: number, z: number) => number | undefined; readonly addSand: (x: number, z: number, r: number, dh: number, cap: number) => void;
    readonly clearSand: () => void; readonly drainSand: (dt: number, rate: number) => void; readonly inChamber: (p: Vector3) => boolean; readonly setSealed: (on: boolean) => void };
  readonly body: { readonly spawn: () => A | null; readonly retire: (actor: A) => void; readonly bind: (actor: A, brain: PhasedBossBrain<A>) => void; readonly ready: (actor: A, floorY: number) => void };
  readonly spawnAdd: PhasedBossPorts<A>['spawnAdd'];
  readonly target: () => ArenaFightTarget;
  readonly combat: Pick<CombatPipeline, 'hit'>;
  readonly physics: () => Physics | null;
  readonly rng: () => number;
  readonly feed: (line: string) => void;
}
/** The fight a row describes: the same strikes, hazards and hurts for whichever host lends its ports. */
export function arenaRoomFight<A extends ArenaFightBody>(ports: ArenaFightPorts<A>, rows: BoundedArenaFight, views: (presentation: BoundedArenaFight['presentation']) => BossViewBinding): {
  phased: PhasedBossFight<A>; script: BossScript; body: () => A | null; devKill: () => void;
} {
  const profile = parseBossProfile(rows.profile);
  if (profile.pattern !== 'arena') throw new Error('Arena room requires an arena boss profile');
  const { room, body, combat, physics } = ports, cuts = rows.cuts.map(strikeFromData), hazards = new Map(Object.entries(rows.hazards).map(([id, row]) => [id, strikeFromData(row)]));
  const contacts = new StrikeRunner();
  const phased = bossFight<A>(profile, {
    arena: { floorAt: room.floorHeightAt, pile: (x, z, r, dh, cap) => { room.addSand(x, z, r, dh, cap); },
      clear: () => { room.clearSand(); }, drain: (dt, rate) => { room.drainSand(dt, rate); },
      inArena: p => room.inChamber(p) && p.z < rows.maxZ, seal: on => { room.setSealed(on); } },
    body: { spawn: () => body.spawn(), retire: actor => { body.retire(actor); }, bind: (actor, brain) => { body.bind(actor, brain); }, ready: (actor, floorY) => { body.ready(actor, floorY); } },
    spawnAdd: ports.spawnAdd,
    player: { get position() { return ports.target().position; }, dash: (x, z, seconds) => { ports.target().dash(x, z, seconds); } },
    hurt: (amount, throughWalls = false) => {
      const actor = phased.body(), { position, health } = ports.target();
      if (actor === null || health === null || (!throughWalls && !canReach(actor, position, physics()))) return;
      combat.hit({ source: 'env', sourceTags: [rows.damageTag, 'feel.blow', 'cover.checked'], target: health, amount,
        point: actor.position, dir: new Vector3(), cause: { kind: actor.kind, label: actor.label } });
    },
    cut: (i, actor, hit) => {
      const strike = cuts[i] ?? cuts[0], { position } = ports.target();
      return strike !== undefined && contacts.contact(strike, { actor, target: position, hit, canReach: () => canReach(actor, position, physics()) });
    },
    hazard: (id, from, hit, options) => {
      const strike = hazards.get(id); if (strike === undefined) throw new Error('Missing arena hazard strike');
      const noop = (): void => undefined, { position } = ports.target();
      const actor = { position: from, scale: 1, yaw: 0, alive: true, dims: { bodyY: 1.2, bodyRadius: .1 },
        headWorld: (out: Vector3) => out.copy(from).add(new Vector3(0, 1.2, 0)), startAttack: noop, cancelAttack: noop, setMotion: noop };
      contacts.contact(strike, { actor, target: position, hit, ...options, canReach: () => canReach(actor, position, physics()) });
    },
    rng: ports.rng, feed: ports.feed,
    views: views(rows.presentation),
    rewardPoint: () => new Vector3().fromArray(rows.reward),
    respawnPoint: () => ({ pos: new Vector3().fromArray(rows.respawn), yaw: rows.yaw }),
  });
  return { phased, script: phased.script, body: phased.body, devKill: phased.kill };
}
