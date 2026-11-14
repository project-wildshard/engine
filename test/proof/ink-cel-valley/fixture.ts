// oxlint-disable-next-line import/no-nodejs-modules -- Milestone witnesses execute in plain Node against admitted in-tree bytes.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { inkProofFolder } from './folder';
import { createShardfileSim, bindShardfileSim, type ShardfileSimulation, type ShardfileSimPorts } from '../../../src/server/game/plugin/simulation';
import { loadRapier, type Rapier } from '../../../src/shared/engine/physics/rapier';
import { canonicalSimDigest } from '../../fake/simState';
import { SaveStore, type SaveStorage } from '../../../src/shared/engine/saves/store';
import { Ledger, installLedgerEmitter, type LedgerEmitter } from '../../../src/shared/game/ledger';
import { snapshotSimHost } from '../../../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../../../src/server/engine/sim/restore';
import type { SimHost } from '../../../src/server/engine/sim';
import { ItemRuntime, scriptItemHook } from '../../../src/shared/engine/combat/items';
import { leadCommands, leadPlayer } from '@wildshard/engine/sim/leadPlayer';

type ProofSimulation = ShardfileSimulation & { items: ReadonlyMap<string, ItemRuntime> };

class ProfileStorage implements SaveStorage {
  private readonly data = new Map<string, string>();
  get length(): number { return this.data.size; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
  copy(): ProfileStorage { const next = new ProfileStorage(); for (const [key, value] of this.data) next.setItem(key, value); return next; }
}
const { source, assets } = inkProofFolder();
const identity = { instance: 'ink-solo', shard: source.identity.slug, revision: source.identity.revision };
const origin = { kind: 'engine' as const, source: 'quest.complete' };
/** A continuation's hash: the snapshot in canonical form (test/fake/simState.ts: Rapier's snapshot bytes are not canonical) */
const digest = (host: SimHost): string => canonicalSimDigest(snapshotSimHost(host));
const requireValue = <T>(value: T | undefined, message: string): T => { if (value === undefined) throw new Error(message); return value; };

export function inkRapier(): Promise<Rapier> { return loadRapier(readFileSync(new URL('../../../public/assets/physics/rapier.wasm', import.meta.url))); }
function profile(local: ProfileStorage): Ledger { return new Ledger(new SaveStore({ local, session: null }), [{ id: identity.instance, shard: identity.shard }], [{ shard: identity.shard, revision: identity.revision, rules: source.ledger }], []); }
function ports(rapier: Rapier, ledger: Ledger): { ports: ShardfileSimPorts; install: (host: SimHost) => void } {
  let emitter: LedgerEmitter | undefined, installed: SimHost | undefined;
  return { ports: { rapier, quest: { fact: (name, entity) => { requireValue(emitter, 'Ledger must be installed before ticking').emit(name, entity); }, coins: (amount, actor) => {
    const host = requireValue(installed, 'Coin port must be installed before ticking'), key = `coins.${actor}`, prior = host.slots.questState[key];
    host.slots.questState[key] = (typeof prior === 'number' ? prior : 0) + amount;
  } } },
    install: (host) => { installed = host; emitter = installLedgerEmitter(host, ledger, identity, origin); },
  };
}
function itemRuntimes(sim: ShardfileSimulation): ProofSimulation {
  const lane = requireValue(sim.lane, 'Items require the admitted script lane'), items = new Map<string, ItemRuntime>();
  for (const row of source.items.rows) {
    const runtime = new ItemRuntime(row, { actor: leadPlayer(sim.host).health, combat: sim.host.combat,
      hook: row.hook === null ? null : scriptItemHook(lane.host, row.hook.module, row.hook.entity, row.hook.event, leadPlayer(sim.host).id),
      targets: () => [...sim.host.entities.values()].map((actor) => Object.assign(sim.host.combat.targetPort(actor.combatActor(), actor), { aimPoint: actor.position.clone().add(new Vector3(0, actor.dims.bodyY * actor.scale, 0)) })),
      effect: () => { throw new Error('This suffix uses light contacts; heavy effects have their separate SF7e proof'); },
    });
    items.set(row.id, runtime);
    sim.host.onStep(`item.${row.id}`, (dt) => {
      runtime.step(sim.host.state.tick, dt);
      if (row.kind === 'tool') {
        const handle = requireValue(sim.actors.get(leadPlayer(sim.host).id), 'Missing item owner');
        lane.world.prepare([{ op: 6, a: 201, b: runtime.remainingFuel, c: 0, d: 0 }, { op: 6, a: 202, b: Number(runtime.lightOn), c: 0, d: 0 }], handle, 0, 0).commit();
      }
    }, { snapshot: () => JSON.stringify(runtime.snapshot()), restore: (value) => {
      if (typeof value !== 'string') throw new Error('Invalid item continuation');
      runtime.restore(JSON.parse(value) as ReturnType<ItemRuntime['snapshot']>);
    } });
  }
  return { ...sim, items };
}
function boot(rapier: Rapier, local = new ProfileStorage()): { sim: ProofSimulation; ledger: Ledger; local: ProfileStorage } {
  const ledger = profile(local), hooks = ports(rapier, ledger), sim = itemRuntimes(createShardfileSim(source, assets, hooks.ports)); hooks.install(sim.host);
  return { sim, ledger, local };
}
function tick(sim: ShardfileSimulation, count: number): void { for (let i = 0; i < count; i++) sim.host.step(leadCommands(sim.host, { moveX: 0, moveZ: 0, yaw: leadPlayer(sim.host).yaw })); }
function hit(sim: ProofSimulation, id: string): void {
  const actor = requireValue(sim.host.entities.get(id), 'Missing declared creature');
  const aimOrigin = leadPlayer(sim.host).position.clone().add(new Vector3(0, 1.2, 0)), point = actor.position.clone().add(new Vector3(0, actor.dims.bodyY * actor.scale, 0));
  requireValue(sim.items.get('weapon.ink-whip'), 'Missing whip').queue(1, { origin: aimOrigin, direction: point.sub(aimOrigin).normalize() });
}
function finishQuest(sim: ProofSimulation): void {
  leadPlayer(sim.host).position.set(0, 0.3, -9); tick(sim, 2);
  const blob = requireValue(sim.host.entities.get('grey-blob:1'), 'Missing quest blob');
  for (let contact = 0; contact < Math.ceil(blob.maxHp / 18); contact++) {
    leadPlayer(sim.host).position.copy(blob.position).add(new Vector3(0, 0, 2)); hit(sim, blob.entityId); tick(sim, 25);
  }
  tick(sim, 2);
  if (!sim.host.quests[0]?.isComplete || sim.host.slots.ledgerDedupe.length !== 1) throw new Error('Real quest/death/ledger pipeline did not complete');
}

export function bootProof(rapier: Rapier): object {
  const { sim } = boot(rapier);
  try {
    if (sim.host.entities.size !== 3 || sim.encounters.size !== 2 || sim.host.quests.length !== 1 || sim.lane === undefined || sim.colliders.size !== source.props?.colliders.length) throw new Error('Incomplete declared ink valley boot');
    if (!sim.colliders.get('ink.door')?.active() || sim.colliders.get('ink.jump')?.active()) throw new Error('Initial declared collider activation changed');
    return { entities: sim.host.entities.size, encounters: sim.encounters.size, quests: sim.host.quests.length, scripts: sim.lane.host.checkpoint().modules.length, terrain: source.terrain !== null, water: sim.water.size, colliders: sim.colliders.size };
  } finally { sim.dispose(); }
}
export function headlessProof(rapier: Rapier): object {
  const { sim } = boot(rapier);
  try {
    const lane = requireValue(sim.lane, 'Missing script lane'), handle = requireValue(sim.actors.get(leadPlayer(sim.host).id), 'Missing actor handle');
    lane.enqueue({ type: 201, target: handle, value: 1 }); requireValue(sim.items.get('tool.ink-lantern'), 'Missing lantern').queue(3); tick(sim, 10_000);
    if (sim.host.state.tick !== 10_000 || lane.world.view(leadPlayer(sim.host).id).shared['ink.door.open'] !== 1 || lane.host.checkpoint().modules.some((module) => module.failures !== 0 || module.disabled)) throw new Error('Headless script failed');
    if (sim.colliders.get('ink.door')?.active() !== false) throw new Error('Door event did not open its actual physics collider');
    const lamp = requireValue(sim.items.get('tool.ink-lantern'), 'Missing lantern');
    if (lamp.lightOn || lamp.remainingFuel !== 0) throw new Error('Single-owner lantern did not exhaust its fixed-step fuel');
    if (![leadPlayer(sim.host).position, ...[...sim.host.entities.values()].map((entity) => entity.position)].every((point) => [point.x, point.y, point.z].every(Number.isFinite))) throw new Error('Nonfinite headless position');
    return { ticks: sim.host.state.tick, hash: digest(sim.host) };
  } finally { sim.dispose(); }
}
export function replayProof(rapier: Rapier): object {
  const first = boot(rapier); let restored: ProofSimulation | undefined;
  try {
    finishQuest(first.sim);
    requireValue(first.sim.items.get('tool.ink-lantern'), 'Missing lantern').queue(3);
    leadPlayer(first.sim.host).position.set(-15, 0.3, -18); tick(first.sim, 90);
    const boss = requireValue(first.sim.encounters.get('ink.boss'), 'Missing declared Big Blob');
    if (boss.boss.state !== 'fight') throw new Error(`Expected Big Blob fight, received ${boss.boss.state}`);
    hit(first.sim, 'big-blob'); tick(first.sim, 2);
    const lane = requireValue(first.sim.lane, 'Missing script lane'), handle = requireValue(first.sim.actors.get(leadPlayer(first.sim.host).id), 'Missing actor');
    lane.enqueue({ type: 201, target: handle, value: 1 });
    const lamp = requireValue(first.sim.items.get('tool.ink-lantern'), 'Missing lantern');
    if (!lamp.lightOn || lamp.remainingFuel >= 1) throw new Error('Checkpoint lacks live lantern continuation');
    lamp.queue(4);
    const checkpoint = snapshotSimHost(first.sim.host), before = lane.host.checkpoint();
    if (before.modules.every((module) => module.globals.length === 0 || module.memory[30_000] === 0)) throw new Error('Checkpoint lacks mutable script memory/globals');
    const ledger = profile(first.local.copy()), hooks = ports(rapier, ledger);
    // oxlint-disable-next-line unicorn/prefer-structured-clone -- The checkpoint must survive the on-disk JSON wire format.
    const roundTrip = JSON.parse(JSON.stringify(checkpoint)) as typeof checkpoint;
    const host = restoreSimHost(first.sim.host.level, { rapier }, roundTrip, (fresh) => { restored = itemRuntimes(bindShardfileSim(fresh, source, assets, { ...hooks.ports, restoring: true })); hooks.install(fresh); });
    restored = requireValue(restored, 'Restore installer did not bind the declared factory');
    for (let suffix = 0; suffix < 600; suffix++) {
      if (suffix % 60 === 30) { hit(first.sim, 'big-blob'); hit(restored, 'big-blob'); }
      tick(first.sim, 1); tick(restored, 1);
    }
    const hash = digest(first.sim.host), replayHash = digest(host);
    if (hash !== replayHash || JSON.stringify(first.ledger.state()) !== JSON.stringify(ledger.state())) throw new Error('Full ink valley continuation diverged');
    if (boss.boss.phase !== 1 || lane.world.view(leadPlayer(first.sim.host).id).shared['ink.door.open'] !== 1 || first.sim.colliders.get('ink.door')?.active() !== false || restored.colliders.get('ink.door')?.active() !== false) throw new Error('Suffix did not enter the second phase and open the actual door collider');
    return { ticks: 600, hash, replayHash, checkpointTick: checkpoint.state.tick, questComplete: first.sim.host.quests[0]?.isComplete, ledgerDedupe: first.sim.host.slots.ledgerDedupe.length, boss: boss.boss.state, phase: boss.boss.phase };
  } finally { restored?.dispose(); first.sim.dispose(); }
}
export function ledgerProof(rapier: Rapier): object {
  const { sim, ledger, local } = boot(rapier);
  try {
    finishQuest(sim); tick(sim, 120);
    const facts = Object.values(ledger.state().facts), fact = requireValue(facts[0], 'Missing durable quest fact');
    const reopened = profile(local); const receipt = reopened.record(fact), achievement = Object.values(reopened.state().achievements)[0];
    if (facts.length !== 1 || receipt.status !== 'duplicate' || achievement?.earned !== true || achievement.count !== 1) throw new Error('Quest grant failed durable dedupe');
    return { facts: facts.length, receipt: receipt.status, achievement: achievement.id, count: achievement.count };
  } finally { sim.dispose(); }
}
