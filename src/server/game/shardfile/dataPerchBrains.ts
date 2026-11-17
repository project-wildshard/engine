import { parse } from 'valibot';
import { CreaturePerchBodiesSchema, creaturePerchRules, creaturePerchAdmissionRows, type CreaturePerchBody } from '@wildshard/format/creaturePerch';
import { CreatureHomeSchema } from '@wildshard/format/creatures';
import { scriptAdmissionRows } from '@wildshard/format/scriptContract';
import { SCRIPT_LIMITS } from '@wildshard/format/scriptLimits';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { Scope } from '@wildshard/engine/app/scope';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { outputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';
import { serverReturnRows } from './nativeRuntimeLoans';
import type { SimHost } from '@wildshard/engine/sim';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { DeclaredBrainPorts } from './brainRuntime';
import { canReach } from '@wildshard/engine/ai/reach';
import { Vector3 } from 'three';
import { preparePerchBody } from '../population/perchBody';
import { stepPerchBodyRoot } from '../../../shared/game/population/perchRoot';
import { installPerchBodyPools } from './perchBodyPools';
import { bindCreatureSenses } from './creatureSenses';

interface PerchPreparationPorts {
  readonly scope?: Scope;
  readonly sections?: ReadonlyMap<string, unknown> | undefined;
}
/** Use the same metadata and instance limit as full file admission. */
function preflightInstanceCap(shard: Shardfile, bodies: readonly CreaturePerchBody[], sections?: ReadonlyMap<string, unknown>): void {
  const existing = scriptAdmissionRows(sections);
  const rows = [...existing, ...creaturePerchAdmissionRows(bodies, existing)];
  const modules = new Set(rows.filter(row => row.side === 'sim').map(row => row.module));
  if (shard.sim.scripts.length + modules.size > SCRIPT_LIMITS.instances) throw new Error('Exceeded perch whole-host instance cap');
}
/** A child loan must cover its entire selected closure, or it would hide a
 * valid ancestor loan. Unrelated lazy return modules never enter this loan. */
function lendPerchClosure(owner: Scope, assets: ReadonlyMap<string, Uint8Array>, bodies: readonly CreaturePerchBody[]): void {
  const raw = bodies.filter(body => body.program.bytes === '' || body.program.v2?.bytes === '');
  if (raw.length === 0) return;
  const rows = serverReturnRows(creaturePerchAdmissionRows(raw));
  const hashes = new Set(rows.map(row => row.module.slice('blobs/wasm/'.length, -'.wasm'.length)));
  for (const body of raw) {
    if (body.program.bytes === '') hashes.add(body.program.script.module.slice('blobs/wasm/'.length, -'.wasm'.length));
  }
  if ([...hashes].every(hash => assets.get(hash) instanceof Uint8Array)) ReturnProgram.lendModules(owner, assets, rows);
}
/** Resolve actual plain authority before host construction, callbacks or random draws.
 * The original return owner verifies hash, ABI and identity within the perch set;
 * full file admission and this preparation both apply the whole-host limit. */
export function preflightPlainPerches(shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, ports: PerchPreparationPorts = {}): ReadonlyMap<string, CreaturePerchBody> {
  const catalogue = parse(CreaturePerchBodiesSchema, shard.creatures.perchBodies ?? []);
  const errors = creaturePerchRules({ ...shard.creatures, perchBodies: catalogue });
  if (errors.length > 0) throw new Error(`Invalid plain perch authority: ${errors.join('; ')}`);
  const result = new Map(catalogue.map(row => [row.id, row]));
  if (result.size === 0) return result;
  const strikes = new Set(shard.rows.strikes.map(row => row.id));
  const sections = ports.sections ?? outputDescriptor(shard)?.sections;
  preflightInstanceCap(shard, catalogue, sections);
  const owner = new Scope('plain-perch.preflight', ports.scope);
  try {
    lendPerchClosure(owner, assets, catalogue);
    for (const spawn of shard.creatures.spawns) {
      if (spawn.perchBody !== undefined) parse(CreatureHomeSchema, spawn.home);
    }
    for (const body of catalogue) {
      if (!strikes.has(body.policy.strike) || !strikes.has(body.projectile.strike)) throw new Error('Missing declared perch strike');
      try { ReturnProgram.preflight(body.program, owner); }
      catch (error) { throw new Error(`Invalid perch return ${body.id}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
      const { script } = ReturnProgram.projectionBindings(body.program);
      const signals = new Set(Object.values(script.signals)), channels = new Set(Object.values(script.channels));
      if (!signals.has(body.policy.score) || !signals.has(body.policy.height) || !channels.has(body.policy.heightChannel))
        throw new Error('Missing declared perch return signal or channel');
    }
    // Return inventory names a real consumer too. Check overlapping legacy
    // declarations in the same native identity owner before constructing a host.
    // A generated perch inventory row aliases its programme, rather than adding
    // a second consumer. Keep its remaining bindings exact during normalization.
    for (const row of serverReturnRows(sections?.get('actors/return-scripts') ?? [])) {
      if (row.abi === 2) continue; // Its complete resource contract was checked above.
      const body = catalogue.find(candidate => candidate.program.v2 === undefined && candidate.program.script.module === row.module);
      if (body === undefined) continue; // Unrelated lazy consumers retain their own admission owner.
      const [inventory] = creaturePerchAdmissionRows([body]);
      const script = row.id === inventory?.id ? { ...row, id: body.program.script.id } : row;
      try { ReturnProgram.preflight({ ...body.program, script }, owner); }
      catch (error) { throw new Error(`Invalid mixed perch return ${row.id}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
    }
    return result;
  } finally { owner.dispose(); }
}

/** Default data bodies lend native observations/actions to the installer's one
 * PerchHunterBrain. Actor identity, rather than species, selects its authority. */
export function dataPerchBrains(host: SimHost, shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>): Pick<DeclaredBrainPorts, 'perchHunter'> {
  const catalogue = parse(CreaturePerchBodiesSchema, shard.creatures.perchBodies ?? []);
  if (catalogue.length === 0) return {};
  lendPerchClosure(host.scope, assets, catalogue);
  const byId = new Map(catalogue.map(row => [row.id, row]));
  const spawns = new Map(shard.creatures.spawns.map(row => [row.id, row]));
  const species = new Map(shard.rows.species.map(row => [row.id, row]));
  const pools = installPerchBodyPools(host, catalogue, shard.rows);
  const strikes = new Map(shard.rows.strikes.map(({ weight, speed, ...row }) =>
    [row.id, { ...row, motion: { speed }, weight: () => weight }]));
  const sites = new Map(catalogue.map(row => [row.id, {
    perches: row.sites.map(site => new Vector3(...site.at)),
    perchBases: row.sites.map(site => new Vector3(...site.base)),
  }]));
  return { perchHunter: actor => {
    const spawn = spawns.get(actor.entityId), row = spawn?.perchBody === undefined ? undefined : byId.get(spawn.perchBody);
    const strike = row === undefined ? undefined : strikes.get(row.policy.strike);
    const habitat = row === undefined ? undefined : sites.get(row.id);
    if (spawn === undefined || row === undefined || strike === undefined || habitat === undefined || spawn.home === undefined)
      throw new Error('Missing declared per-spawn perch body');
    const home = spawn.home, rng = host.rng.stream('spawn');
    const input = species.get(spawn.species)?.senses, senses = bindCreatureSenses(host, actor, input);
    const herd: AnimalSim[] | null = spawn.group === undefined ? null : shard.creatures.spawns
      .filter(candidate => candidate.group === spawn.group && candidate.perchBody === row.id)
      .map(candidate => { const body = host.entities.get(candidate.id); if (body === undefined) throw new Error('Missing perch herd body'); return body; });
    let selected: ReturnType<SimHost['nearestPlayer']> | undefined;
    const point = new Vector3(), direction = new Vector3();
    const context = {
      dt: 0, player: actor.position, calm: true, rng, herd,
      world: { ...habitat, throwCoconut: (start: Vector3, target: Vector3, source: AnimalSim) => { pools.throw(row.id, start, target, source, rng); } },
      heightAt: (x: number, z: number) => host.groundHeightAt(x, z),
      sound: (_cue: string) => undefined,
      steer: (body: AnimalSim, yaw: number, speed: number, turn: number) => { body.setMotion(yaw, speed, turn); },
      confine: (body: AnimalSim) => {
        const x = body.position.x + Math.sin(body.desiredYaw) * 2, z = body.position.z + Math.cos(body.desiredYaw) * 2;
        if (Math.hypot(x - home.x, z - home.z) > home.r)
          body.setMotion(Math.atan2(home.x - body.position.x, home.z - body.position.z), 0, 3);
      },
      claim: (body: AnimalSim) => host.events.ask('ai.claim', body),
      mayAttack: (body: AnimalSim) => host.events.ask('ai.mayAttack', body),
      reach: (body: AnimalSim) => selected !== undefined && canReach(body, selected.position, host.physics),
      hurt: (damage: number) => {
        if (selected === undefined || !selected.health.alive || host.parked.has(selected.id)) return;
        // Native bite reactions originate at the attacking body. The action
        // owner's contact/reach tests already admit this hit.
        point.copy(actor.position);
        host.combat.hit({ source: actor.combatActor(), sourceTags: strike.tags, target: selected.health,
          amount: damage, point, dir: direction, moveId: strike.id,
          cause: { kind: actor.kind, label: actor.label } });
      },
    };
    const cooldown = host.rng.stream(row.policy.attackStream ?? 'ai');
    const prepared = preparePerchBody(actor, context, strike, ReturnProgram.native(host, row.program), row.policy, cooldown);
    const observe = (dt: number) => {
      // The native attack record already saves the target of an ongoing bite
      // or throw. Turning during that action must not acquire a different one.
      const target = input === undefined || actor.attackPhase < 0 ? undefined : host.attackTarget(actor.entityId);
      const retained = target === undefined ? undefined : host.players.get(target);
      const player = retained?.health.alive === true && !host.parked.has(retained.id) ? retained : senses.nearest();
      selected = player !== undefined && player.health.alive && !host.parked.has(player.id) ? player : undefined;
      if (input !== undefined && selected !== undefined) host.focusPlayer(selected.id);
      context.dt = dt; context.player = selected?.position ?? actor.position; context.calm = selected === undefined;
      return prepared.observe(context);
    };
    return { observe, body: dt => {
      observe(dt); stepPerchBodyRoot(actor, dt, row.policy.root); prepared.brain.act(context);
    } };
  } };
}
