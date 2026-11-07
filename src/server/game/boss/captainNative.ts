/** A night's captain on a server (Nalati's Qara Batyr): the page's `BorrowedElite` script tick over the patrol that already rides there.
 *  He keeps his own rules and his own save beside the world's lairs, so their roster, their records and every tape stay as they are, and
 *  a world saved before he rode here restores with him unspawned. Only a room installs him; a page's own host keeps its own. */
import * as v from 'valibot';
import { Vector3 } from 'three';
import { eliteDamageScale, eliteScriptFrame } from '@wildshard/engine/ai/eliteScript';
import type { HuntBody } from '@wildshard/engine/ai/hunt';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import { pinBrain } from '@wildshard/engine/ai/pinning';
import { canReach } from '@wildshard/engine/ai/reach';
import { strikeFromData } from '@wildshard/engine/ai/strikeRows';
import { StrikeRunner } from '@wildshard/engine/ai/strikes';
import type { SimHost } from '@wildshard/engine/sim';
import { eliteNetView, publishEncounter } from '@wildshard/engine/sim/encounterRows';
import { nearestOnGround } from '@wildshard/engine/sim/nearPlayer';
import { eliteCueWord, eliteLaneWord, sayFightView } from '@wildshard/engine/sim/shardRows';
import { parseExternalElite } from '@wildshard/format/eliteFeature';
import { SpeciesActorsFileSchema } from '@wildshard/format/speciesBookRows';
import type { EliteCore, EliteCoreRecord, EliteCoreScript } from '../../../shared/game/eliteSystem';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { SpawnScript, readSpawnScript } from '../population/spawnScript';
import { nativePopulationOf } from '../riding/nativePopulation';
import { patrolOf } from './patrolNative';

const finite = v.pipe(v.number(), v.finite()), count = v.pipe(finite, v.integer(), v.minValue(0));
const Saved = v.strictObject({ version: v.literal(1), captain: v.nullable(v.string()), fight: v.nullable(v.string()), line: v.pipe(v.array(v.string()), v.maxLength(8)),
  elapsed: finite, phase2: v.boolean(), pinned: v.boolean(), supports: count, signatures: count, hits: count, core: v.unknown() });
const ListedScripts = v.array(v.object({ step: v.string(), species: v.array(v.object({ variant: v.string() })) }));
/** How a captain's blow throws a player: the world's own elites' knockdown row. */
export interface CaptainKnock { readonly speed: number; readonly min: number; readonly max: number; readonly seconds: number }
export interface NativeCaptain {
  readonly advance: (dt: number) => void;
  /** What a blow on `actor` is scaled by, or null: he isn't the captain. */
  readonly scale: (actor: HuntBody, point: Vector3) => number | null;
  /** His lair and its record, for the world's rules to read as their own: what a quest counts of his kills. */
  readonly lair: { readonly id: string; readonly record: EliteCoreRecord | undefined };
}
type Core = EliteCore<EliteCoreScript<AnimalSim>>;

/** Read his rows now; nothing here touches a host. No script-mode elite in `external`: no captain. */
export async function prepareCaptain(product: Pick<ShardProduct, 'json' | 'section' | 'file' | 'shardfile'>, external: readonly unknown[], actorsFile: string, knock: CaptainKnock):
  Promise<((host: SimHost, makeCore: (decisions: ReturnProgram) => Core, step: string) => NativeCaptain) | null> {
  const row = external.map(parseExternalElite).find(candidate => candidate.mode === 'script');
  if (row === undefined) return null;
  const listed = v.parse(ListedScripts, product.section('actors/spawn-scripts')).find(script => script.species.some(species => species.variant === row.spawn.variant));
  if (listed === undefined) throw new Error('Missing captain fight');
  const modules = new Map<string, Uint8Array>(), [actors, rows] = await Promise.all([product.json<unknown>(actorsFile).then(input => v.parse(SpeciesActorsFileSchema, input)), readSpawnScript(product as ShardProduct, listed.step, modules)]);
  const program = actors.species.lookBook.program, module = modules.get(rows.script.module.split('/').at(-1)?.replace('.wasm', '') ?? ''), strikes = rows.strikes?.map(strike => ({ amount: strike.row.damage, strike: strikeFromData(strike.row) }));
  if (program === undefined || module === undefined || strikes === undefined) throw new Error('Missing captain module, program or contacts');
  return (host, makeCore, step) => {
    const patrol = patrolOf(host), population = nativePopulationOf(host);
    if (patrol === undefined || population === undefined) throw new Error('A captain rides with the patrol');
    const decisions = ReturnProgram.native(host, program), core = makeCore(decisions), contact = new StrikeRunner(), { def } = row, id = def.id, cues = Object.keys(row.cues);
    let captain: HuntBody | null = null, fight: SpawnScript | null = null, line: readonly HuntBody[] = [], elapsed = 0, phase2 = false, supports = 0, signatures = 0, hits = 0, telling = false;
    let scope: ReturnType<typeof host.scope.child> | null = null;
    const direction = new Vector3();
    const resolve = (entity: string): HuntBody => { const body = population.bodies.find(candidate => candidate.entityId === entity); if (body === undefined) throw new Error('Captain continuation lost its body'); return body; };
    const pin = (on: boolean): void => {
      if (on && scope === null && captain !== null) { scope = host.scope.child('elite.native-captain'); pinBrain(captain, scope); } else if (!on) { scope?.dispose(); scope = null; }
    };
    const foeOf = (at: { readonly x: number; readonly z: number }) => nearestOnGround(host.players, at.x, at.z);
    const script: EliteCoreScript<AnimalSim> = {
      def, get animal() { return captain; }, canSpawn: () => patrol.readiness.eligible,
      spawn: () => {
        if (captain?.alive === true) throw new Error('Captain cannot respawn a live owner');
        const body = patrol.law.spawnRider({ x: def.lair.x, z: def.lair.z, yaw: row.spawn.yaw, ...row.spawn.source === 'rider' ? { variant: row.spawn.variant } : {} });
        if (body === null) throw new Error('The patrol refused its captain');
        fight = SpawnScript.nativePopulation(host, rows, module); fight.adopt('main', body.entityId); captain = body;
      },
      despawn: () => { pin(false); fight?.interrupt(); for (const body of line) if (body.alive) patrol.law.dissolve(body); line = []; if (captain !== null) patrol.law.dissolve(captain); captain = null; fight = null; },
      reset: () => { phase2 = false; fight?.interrupt(); fight?.signal('main', 0); },
      enterPhase2: () => { phase2 = true; }, trophy: () => undefined,
      tick: (dt, time, engaged, leashing) => {
        if (captain === null || fight === null) return;
        const actor = captain, foe = foeOf(actor.position);
        pin(engaged); elapsed += dt;
        const frame = eliteScriptFrame(row, decisions, fight, elapsed, dt, foe.position, { kills: patrol.law.killsTonight, engaged, leashing, phase2, time, line: line.filter(body => body.alive).length, yaw: () => actor.yaw });
        elapsed = frame.elapsed;
        for (const effect of frame.effects) {
          if (effect.kind === 'support') { line = patrol.law.spawnLine({ count: effect.count }); supports += line.length; }
          else if (effect.kind === 'hit') {
            const strike = strikes.find(candidate => candidate.amount === effect.amount), struck = foeOf(actor.position); if (strike === undefined) throw new Error('Undeclared captain contact');
            contact.contact(strike.strike, { actor, target: struck.position, canReach: () => canReach(actor, struck.position, host.physics), hit: () => {
              host.combat.hit({ source: 'env', sourceTags: [`elite.${actor.variant}`, 'feel.blow', 'cover.checked'], target: struck.health, amount: effect.amount, point: actor.position, dir: direction.set(0, 0, 0), cause: { kind: actor.kind, label: actor.label } }); } });
            const length = Math.hypot(effect.knockX, effect.knockZ) || 1, speed = knock.speed * Math.max(knock.min, Math.min(knock.max, 1));
            struck.dashAt(effect.knockX / length * speed, effect.knockZ / length * speed, knock.seconds); hits++;
          } else if (effect.kind === 'cue') {
            if (effect.signature) { core.signature(id); signatures++; }
            const cue = cues.findIndex(name => { const said = row.cues[name]; return said?.voice === effect.voice && said?.feed === effect.feed && (said?.signature === true) === effect.signature; });
            if (cue !== -1 && (effect.voice !== undefined || effect.feed !== undefined)) sayFightView(host, eliteCueWord(id), [cue, actor.position.x, actor.position.y, actor.position.z]);
          } else throw new Error('A captain emits no page operations');
        }
        // The page draws what the fight says. `behaviour/eliteViews.as`'s strengths: a windup, then the blow.
        const { tell } = frame;
        if (tell !== null) { telling = true; sayFightView(host, eliteLaneWord(id), [tell.x0, tell.z0, tell.x1, tell.z1, tell.width, tell.strike === 1 ? 0.42 : 0.36, time]); }
        else if (telling) { telling = false; sayFightView(host, eliteLaneWord(id), []); }
      },
    };
    const entry = core.add(script);
    publishEncounter(host, id, () => eliteNetView({ ...entry, script }));
    host.scope.onDispose(() => { pin(false); });
    host.onStep(step, () => undefined, {
      joined: true,
      snapshot: () => JSON.stringify({ version: 1, captain: captain?.entityId ?? null, fight: fight?.snapshot() ?? null, line: line.map(body => body.entityId), elapsed, phase2, pinned: scope !== null, supports, signatures, hits, core: core.snapshot() }),
      restore: value => {
        if (typeof value !== 'string') throw new Error('Captain continuation is a string');
        const saved = v.parse(Saved, JSON.parse(value)), commit = core.prepareRestore(saved.core);
        if ((saved.captain === null) !== (saved.fight === null) || saved.pinned && saved.captain === null) throw new Error('Captain continuation lost its fight');
        pin(false); captain = saved.captain === null ? null : resolve(saved.captain);
        fight = saved.fight === null ? null : SpawnScript.nativePopulation(host, rows, module); if (fight !== null && saved.fight !== null) fight.restore(saved.fight);
        line = saved.line.map(resolve); elapsed = saved.elapsed; phase2 = saved.phase2; supports = saved.supports; signatures = saved.signatures; hits = saved.hits;
        commit(); pin(saved.pinned);
      },
    });
    return { lair: { id, record: core.record(id) }, advance: dt => {
      line = line.filter(body => population.bodies.includes(body));
      if (captain !== null && !captain.alive && !population.bodies.includes(captain)) { pin(false); fight?.interrupt(); captain = null; fight = null; }
      core.update(dt, host.clock.now);
    }, scale: (actor, point) => actor === captain ? eliteDamageScale(row, decisions, Number(fight?.state('main')['mode'] ?? 0), point.distanceTo(foeOf(actor.position).position)) : null };
  };
}
