/** Native roaming boss binding: rows supply identity, streams and strike names;
 * the existing AS guest owns choices and the platform owns native effects. */
import type { SpeciesProgramData } from '@wildshard/format/speciesPrograms';
import type { SpeciesDecisionAuthority } from '../plugin/brain';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { BossBrain } from '@wildshard/engine/ai/BossBrain';
import { fnv1a32, Rng, type RngState } from '@wildshard/engine/core/rng';
import type { RoamingEncounterRow } from '@wildshard/format/bossEncounter';
import { strikeFromData } from '@wildshard/engine/ai/strikeRows';
import { StrikeRunner } from '@wildshard/engine/ai/strikes';
import type { LaneState } from '../../../shared/game/boss/lane';
import { bossFight, type RoamingBossFight, type RoamingBossPorts } from '../plugin/bossPhase';

const contact = new StrikeRunner();

/** Native roster body; its decision binding and physics owner are borrowed. */
export interface GroundBossBody extends AnimalSim { hp: number; readonly maxHp: number; herd: number; place: (x: number, z: number, yaw: number) => void }
/** The native or rendered world's existing contact, health and feedback ports. */
export interface GroundBossEnv<B extends GroundBossBody> extends Pick<GroundBossPorts<B>, 'player'|'hurt'|'trauma'|'shot'> {
  readonly reach: (actor:B,target:{readonly x:number;readonly y:number;readonly z:number})=>boolean;
}
/** One fight state, with the real lane and independent seeded stream continuations. */
export type GroundBossFight<B extends GroundBossBody> = RoamingBossFight<B, LaneState, RngState>;
type GroundBossMove = string;
type GroundBossSound = string;
type GroundBossPorts<B extends GroundBossBody> = RoamingBossPorts<B, LaneState, RngState, string, GroundBossMove, GroundBossSound>;
/** Body lifetime, adds and views lent to the shared roaming mechanics. */
export type GroundBossHost<B extends GroundBossBody> = Omit<GroundBossPorts<B>, 'player' | 'random' | 'contact' | 'hurt' | 'trauma' | 'shot'>;

const bossStreams = (seed: number, row: RoamingEncounterRow): { readonly call: Rng; readonly charge: Rng } =>
  ({ call: new Rng(fnv1a32(`${String(seed)}:${row.streams.call}`)), charge: new Rng(fnv1a32(`${String(seed)}:${row.streams.charge}`)) });

/** Bind declared strikes and seeded streams to the existing roaming effects host. */
export function createGroundBossFight<B extends GroundBossBody>(row: RoamingEncounterRow, env: GroundBossEnv<B>, host: GroundBossHost<B>, seed: number, program: SpeciesProgramData, decisions: SpeciesDecisionAuthority): GroundBossFight<B> {
  const profile = row.profile;
  const species=program.species.find(candidate=>candidate.kind===row.kind);
  if(species?.brain?.archetype!=='decision'||species.body===undefined)throw new Error('Boss requires its admitted decision/body recipe');
  const declared=species.brain.data,recipe=species.body;
  const bound=new WeakSet<B>();
  const bind=(actor:B):B=>{if(!bound.has(actor)){decisions.bind(actor,declared,recipe);bound.add(actor);}return actor;};
  const contacts = new Map(program.strikes.map(strikeData => [strikeData.id, strikeFromData(strikeData)]));
  const body={...host.body,make:():B=>bind(host.body.make())};
  const fight = bossFight(profile, { ...host, body, player: env.player, random: bossStreams(seed, row),
    contact: (a, strike, hit, options) => {
      const spec = contacts.get(`${row.strikePrefix}${strike}`);
      if (spec === undefined) throw new Error(`Unknown boss strike ${strike}`);
      if (!contact.contains(spec, { actor: { position: a.position, scale: a.scale, yaw: a.yaw }, target: env.player.position, ...options }) || (!spec.tags.includes('cover.exempt') && !env.reach(a, env.player.position))) return false;
      hit(spec.damage); return true;
    },
    hurt: (a, damage, through) => { env.hurt(a, damage, through); }, trauma: amount => { env.trauma(amount); }, shot: (sound, at) => { env.shot(sound, at); } });
  const restore = fight.restore.bind(fight);
  fight.restore = (saved, bodies) => {
    const actor = saved.body === null ? undefined : bodies.get(saved.body);
    if (actor !== undefined && !bound.has(actor)) {
      // Binding initializes the guest's physical pose; the existing body owner
      // has already restored its attack and motion before this adapter runs.
      const state = actor.snapshot();
      bind(actor);
      actor.restore(state);
    }
    restore(saved, bodies);
  };
  return fight;
}


/** Presence runs before the brain, preserving the authored arrival/departure bands. */
export function groundBossPresence(row: RoamingEncounterRow, boss: BossBrain, fight: Pick<GroundBossFight<GroundBossBody>, 'setPresent'>,
  player: { readonly x: number; readonly z: number }, available: boolean): void {
  const at = row.profile.fight.origin, d = Math.hypot(player.x - at.x, player.z - at.z), s = boss.state;
  if (s === 'dormant') { if (available && d < row.presence.enter) { fight.setPresent(true); boss.arm(); } }
  else if ((s === 'armed' || s === 'victory') && (d > row.presence.leave || !available)) { boss.disarm(); fight.setPresent(false); }
}
/** A dormant encounter still advances its room once, after the brain's step. */
export function groundBossDormant(boss: BossBrain, fight: Pick<GroundBossFight<GroundBossBody>, 'update'>, dt: number, t: number): void {
  if (boss.state === 'dormant') fight.update(dt, t, false);
}
