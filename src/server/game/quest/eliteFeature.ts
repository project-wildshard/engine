import { pageStateOf } from '../../../shared/game/shardfile/runtimeState';
import { sayFightView } from '@wildshard/engine/sim/shardRows';
import { ELITE_TELL } from '../../../shared/game/shardfile/wirePrompts';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { EliteCoreContinuationSchema } from '@wildshard/format/eliteContinuation';
import { Vector3 } from 'three';
import * as v from 'valibot';
import { parseEliteFeature, type EliteFeatureRows } from '@wildshard/format/eliteFeature';
import type { SimHost, SimValue } from '@wildshard/engine/sim';
import type { DayCycleClock } from '@wildshard/engine/world/dayCycle';
import { EliteCore, memoryElitePersistence } from '../../../shared/game/eliteSystem';
import { eliteDrops } from './eliteDrops';
import { EliteDecisions } from '../../../shared/game/quest/eliteDecisions';
import { SpawnScript, readSpawnScript } from '../population/spawnScript';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { nearestOnGround } from '@wildshard/engine/sim/nearPlayer';
import { eliteNetView, publishEncounter } from '@wildshard/engine/sim/encounterRows';

const finite = v.pipe(v.number(), v.finite());
const uint = v.pipe(finite, v.integer(), v.minValue(0), v.maxValue(0xffffffff));
const stream = v.strictObject({ version: v.literal(1), state: uint, initial: uint, scrambledFork: v.boolean() });
const savedScript = v.strictObject({ id: v.string(), program: v.string(), spawn: stream, phase2: v.boolean() });
const root = v.strictObject({ t: v.pipe(finite, v.minValue(0)), x: finite, y: finite, z: finite });

/** Read admitted JSON and exact v1 bytes using the same owned-script catalogue as population directors. */
export async function readEliteFeature(product: ShardProduct, name: string): Promise<EliteFeatureRows> {
  const rows = parseEliteFeature(JSON.parse(new TextDecoder().decode(await product.file(name))));
  const fights = await Promise.all(rows.fights.map(async fight => {
    const program = await readSpawnScript(product, fight.program.step);
    if (JSON.stringify({ ...program, bytes: '' }) !== JSON.stringify({ ...fight.program, bytes: '' })) throw new Error('Elite program catalogue mismatch');
    return { ...fight, program };
  }));
  return { ...rows, fights };
}

/** Native named encounters take only the real simulation/clock authorities and rows. Fight decisions run in v1 guests. */
export function installNativeEliteFeature(host: SimHost, day: DayCycleClock, input: unknown): {
  readonly core: EliteCore<EliteDecisions>; readonly scripts: readonly EliteDecisions[]; readonly initialize: () => void;
} {
  const rows = parseEliteFeature(input);
  if (rows.fights.some(row => row.def.rule === 'storm')) throw new Error('Storm encounter needs an admitted weather owner');
  const drops = eliteDrops<EliteDecisions>(host);
  const core = new EliteCore<EliteDecisions>({ players: host.players, condition: rule => rule === 'always'
    || (rule === 'dusk' ? day.dusk > 0.5 : rule === 'night' ? day.night > 0.5 : false) }, drops.hooks, host.level.id, memoryElitePersistence(host.level.id, pageStateOf(host, '.elites')));
  drops.bind(core);
  const scripts = rows.fights.map(row => { const program = SpawnScript.native(host, row.program); return new EliteDecisions(row, () => program, rows, host.level.seed); });
  for (const script of scripts) { const entry = core.add(script); publishEncounter(host, script.def.id, () => eliteNetView(entry)); }
  const saved = v.strictObject({ version: v.literal(rows.version), ...EliteCoreContinuationSchema.entries, scripts: v.array(savedScript), stun: v.nullable(root), others: v.exactOptional(v.record(v.string(), root)) });
  type Stun = v.InferOutput<typeof root>;
  let restored: SimValue | undefined;
  /** Who is held by a stun, by player. `stun` on the wire is the room's first player; `others` appears only for the rest. */
  const stuns = new Map<string, Stun>();
  const firstId = (): string => { const first = host.players.keys().next(); if (first.done === true) throw new Error('Simulation host has no player'); return first.value; };
  const setStuns = (first: Stun | null, others: Readonly<Record<string, Stun>> = {}): void => {
    stuns.clear(); if (first !== null) stuns.set(firstId(), first);
    for (const [id, row] of Object.entries(others)) stuns.set(id, row);
  };
  const wireStuns = (): { stun: Stun | null; others?: Record<string, Stun> } => {
    const lead = firstId(), others = Object.fromEntries([...stuns].flatMap(([id, row]) => id === lead ? [] : [[id, { ...row }]])), first = stuns.get(lead);
    return { stun: first === undefined ? null : { ...first }, ...(Object.keys(others).length === 0 ? {} : { others }) };
  };
  const validateRecords = (records: Readonly<Record<string, unknown>>): void => {
    if (scripts.some(script => records[script.def.id] === undefined)) throw new Error('Incompatible elite records'); // more than the roster: a page's lairs, kept
  };
  const held = new Vector3(), direction = new Vector3(), routes = actRoutes(host);
  // Whatever way a lair's body lands a blow, and its bite isn't always its script's.
  host.events.answer('damage.modify', req => req !== null && routes.god === true && [...host.players.values()].some(player => player.health === req.target) && scripts.some(script => script.animal?.combatActor() === req.source) ? null : req, host.scope, { order: 1 });
  host.onStep(rows.step, dt => {
    restored = undefined;
    for (const [id, stun] of stuns) {
      const player = host.players.get(id);
      if (player === undefined) { stuns.delete(id); continue; }
      held.set(stun.x, stun.y, stun.z); player.position.copy(held); player.motor.resetAt(held); stun.t -= dt; if (stun.t <= 0) stuns.delete(id);
    }
    for (const script of scripts) {
      const at = script.animal?.position ?? script.def.lair, foe = nearestOnGround(host.players, at.x, at.z);
      script.frame(foe.position, day.dusk, day.night, routes.god === true, foe.yaw);
    }
    core.update(dt, host.clock.now);
    for (const [index, script] of scripts.entries()) for (const strike of script.program.strikePresentation()) {
      const body = script.program.body(strike.actor), name = strike.tell === 'lane' ? ELITE_TELL.lane : strike.tell === 'ring' ? ELITE_TELL.ring : null;
      if (body === null || name === null) continue;
      sayFightView(host, name, [index * 256 + strike.actor, strike.phase === 'windup' ? 0 : strike.phase === 'active' ? 1 : 2, strike.time, strike.windup, strike.x0, strike.z0, strike.x1, strike.z1, strike.width, strike.radius, body.position.x, body.position.z]);
    }
    for (const [index, script] of scripts.entries()) for (const effect of script.program.drainEffects()) {
      if (effect.kind === 'cue') {
        const name = script.program.cue(effect.id), cue = rows.view?.cues.findIndex(row => row.id === name) ?? -1, body = script.program.body(effect.actor);
        if (rows.view?.cues[cue]?.signature === true) core.signature(script.def.id);
        // the page's voice, puff and shake, off the same rows
        if (cue !== -1 && body !== null) sayFightView(host, ELITE_TELL.cue, [cue, index, effect.at.x, effect.at.y, effect.at.z, body.position.x, body.position.y, body.position.z, body.scale]);
        continue;
      }
      if (effect.kind !== 'hit' || routes.god === true) continue;
      const body = script.program.body(effect.actor); if (body === null) throw new Error('Missing elite contact body');
      const foe = nearestOnGround(host.players, body.position.x, body.position.z);
      host.combat.hit({ source: body.combatActor(), sourceTags: [`creature.${body.kind}`, 'feel.blow', 'cover.checked'], target: foe.health,
        amount: effect.hit.damage, point: body.position.clone(), dir: direction.set(0, 0, 0), throughWalls: effect.hit.throughWalls, cause: { kind: body.kind, label: body.label } });
      if (effect.hit.trauma > 0) sayFightView(host, ELITE_TELL.hit, [effect.hit.trauma, foe.position.x, foe.position.z]);
      if (effect.hit.stun > 0) { const p = foe.position, stun = stuns.get(foe.id); stuns.set(foe.id, { t: effect.hit.stun, x: stun?.x ?? p.x, y: stun?.y ?? p.y, z: stun?.z ?? p.z }); }
    }
  }, {
    snapshot: () => { if (restored !== undefined) return restored; const { stun, others } = wireStuns();
      return { version: rows.version, ...core.snapshot(), stun, scripts: scripts.map(script => ({ id: script.def.id,
        program: script.program.snapshot(), spawn: { ...script.spawnStream.snapshot() }, phase2: script.isPhase2 })), ...(others === undefined ? {} : { others }) }; },
    restore: wireInput => {
      if (typeof wireInput === 'object' && wireInput !== null && !Array.isArray(wireInput) && 'version' in wireInput && wireInput['version'] !== rows.version) {
        const mapping = rows.legacy, upgrade = mapping?.upgrades.find(row => row.version === wireInput['version']);
        if (mapping === undefined || upgrade === undefined) throw new Error('Unsupported historical elite wire');
        const envelope: v.ObjectEntries = { version: v.literal(upgrade.version), ...EliteCoreContinuationSchema.entries, [mapping.scripts]: v.array(v.record(v.string(), v.unknown())) };
        if (!upgrade.clearStun) envelope[mapping.stun] = v.nullable(root);
        const raw = upgrade.clearStun ? Object.fromEntries(Object.entries(wireInput).filter(([key]) => key !== mapping.stun)) : wireInput;
        const old = v.parse(v.strictObject(envelope), raw), continuation = v.parse(EliteCoreContinuationSchema, old);
        validateRecords(continuation.records);
        const source = v.parse(v.array(v.record(v.string(), v.unknown())), old[mapping.scripts]);
        if (source.length !== scripts.length) throw new Error('Historical elite roster mismatch');
        const commits = source.map((wire, i) => {
          const script = scripts[i]; if (script === undefined) throw new Error('Missing historical elite');
          const fields = v.parse(v.record(v.string(), v.union([finite, v.boolean(), v.null()])), wire['fields']);
          const state = { ...Object.fromEntries(Object.entries(wire).filter(([key]) => !upgrade.remove.includes(key))),
            ...(upgrade.bindInstalled ? { animal: script.animal?.entityId ?? null } : {}), fields: { ...upgrade.defaults[script.def.id], ...fields } };
          if (state.fields[script.row.legacy.phase] !== continuation.entries[i]?.phase2) throw new Error('Historical elite phase mismatch');
          return script.prepareLegacy(state);
        });
        const commit = core.prepareRestore(continuation), nextStun = upgrade.clearStun ? null : v.parse(v.nullable(root), old[mapping.stun]);
        commit(); for (const restore of commits) restore(); setStuns(nextStun); restored = structuredClone(wireInput); return;
      }
      const state = v.parse(saved, wireInput); validateRecords(state.records);
      const commitCore = core.prepareRestore(state);
      if (state.scripts.length !== scripts.length || state.scripts.some((row, i) => row.id !== scripts[i]?.def.id
        || row.phase2 !== state.entries[i]?.phase2)) throw new Error('Incompatible elite script roster');
      const commits = state.scripts.map((row, i) => {
        const script = scripts[i]; if (script === undefined) throw new Error('Missing elite script');
        return script.prepareRestore(row);
      });
      commitCore(); for (const commit of commits) commit(); setStuns(state.stun, state.others); restored = structuredClone(wireInput);
    },
  });
  return { core, scripts, initialize: () => { core.initialize(); } };
}
