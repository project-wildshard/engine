// SENTRY-TRIAGE S3 (WILDSHARD-GAME-82): a v2 group guest that traps keeps the group's last state and says so once.
// The Nalati herd's module ran out of fuel mid-call and the meter trapped as `RuntimeError: unreachable`; the host
// treats that as one failed step. `group-trap.wasm` (source `fixtures/group-trap/group-trap.as`, rebuilt by its
// `build.mjs`) traps two ways after it has drawn from the borrowed RNG and written its bank: `unreachable()` and an
// endless loop the v2 fuel meter stops. It is driven three ways: through `GroupStepV2` alone, through
// `GroupBrain.runGuest` with the grazer's catch, and through a real herd `GrazerBrain.tick` bound to the module.
// oxlint-disable-next-line import/no-nodejs-modules -- the committed fixture module's bytes
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { parseGroupStepV2 } from '@wildshard/format/scriptGroupStepV2';
import type { GroupBankValueV2 } from '@wildshard/format/scriptGroupBankV2';
import { GroupBrain, type GroupGuestFrameV2, type GroupGuestProjectionV2, type GroupGuestPublicationV2 } from '../src/shared/engine/ai/GroupBrain';
import { Scope } from '../src/shared/engine/app/scope';
import { onFault, type Fault } from '../src/shared/engine/core/faults';
import { Rng } from '../src/shared/engine/core/rng';
import { GrazerBrain, type GuardedHerdContext, type GuardedHerdPorts } from '../src/server/engine/ai/grazer';
import { AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import { GroupStepV2 } from '../src/shared/engine/script/groupStepV2';
import herdRows from './fixtures/group-trap/herd-rows.json' with { type: 'json' };
import rows from './fixtures/group-trap/rows.json' with { type: 'json' };

const bytes = Uint8Array.from(readFileSync('test/fixtures/group-trap/group-trap.wasm'));
const herdBytes = Uint8Array.from(readFileSync('test/fixtures/group-trap/herd-trap.wasm'));
const TRAPS = ['trap', 'spin', 'trap', 'spin'] as const;
type Members = GroupGuestFrameV2['input']['members'];

/** One herd over the trap module: a two-field bank, a borrowed RNG, and the grazer's catch around each frame. */
class TrapHerd extends GroupBrain<AnimalSim> {
  readonly bank = new Float64Array(2);
  readonly random = new Rng(23);
  signal = 'advance';
  commits = 0;
  published: GroupBankValueV2 | undefined;
  private readonly owners: Members;
  private readonly resume = Object.freeze({ field: 'pc', values: Object.freeze([0]), segments: 4 });
  constructor(private readonly scope: Scope, private readonly program: GroupGuestProjectionV2) {
    super([]);
    this.owners = [{ scope, self: { group: 'herd', slot: 0, identity: '', actor: null }, player: { position: { x: 0, z: 0 } },
      observed: new Map(), t: 0, dt: 0.1 }];
  }
  /** `GrazerBrain.think`/`act`: a bound guest's failure is skipped, never thrown into the loop. */
  frame(): void {
    try { this.runGuest(this.program); } catch (error) { this.skipGuestFrame(error); }
  }
  protected override captureGuest(): GroupGuestFrameV2<AnimalSim> {
    return { input: { group: 'herd', handle: 1, signal: this.signal, tick: 0, state: this.bank, members: this.owners, references: [], random: this.random },
      native: { scope: this.scope, members: this.owners }, resume: this.resume };
  }
  protected override prepareGuestCommit(_frame: GroupGuestFrameV2<AnimalSim>, values: Readonly<Record<string, GroupBankValueV2>>): GroupGuestPublicationV2 {
    return { validate: () => undefined, commit: () => { this.commits++; this.published = values['count']; } };
  }
}

function host(name: string): { scope: Scope; step: GroupStepV2 } {
  const scope = new Scope(name), step = new GroupStepV2(bytes, rows, scope);
  expect(step.layout.bytes).toBe(1056); // build.mjs compiles against this
  return { scope, step };
}

test('a guest trap mid-call leaves the bank and RNG as they were, and the same module runs the next call', () => {
  const { scope, step } = host('group-trap-host'), state = new Float64Array(2), random = new Rng(31), oracle = new Rng(31);
  try {
    const input = (signal: string) => ({ group: 'herd', handle: 1, signal, tick: 0, state, members: [], references: [], random });
    step.prepare(input('advance')).accept();
    expect(Array.from(state)).toStrictEqual([1 + oracle.next(), 0]);
    const bank = state.slice(), entropy = random.snapshot();
    for (const signal of TRAPS) {
      expect(() => step.prepare(input(signal))).toThrow(WebAssembly.RuntimeError);
      expect(state).toStrictEqual(bank);
      expect(random.snapshot()).toStrictEqual(entropy);
    }
    step.prepare(input('advance')).accept();
    expect(Array.from(state)).toStrictEqual([(bank[0] ?? Number.NaN) + 1 + oracle.next(), 0]);
    expect(random.snapshot()).toStrictEqual(oracle.snapshot());
  } finally { scope.dispose(); }
});

test('a trapping v2 group keeps its prior state, reports once and steps on after', () => {
  const { scope, step } = host('group-trap-brain'), oracle = new Rng(23), faults: Fault[] = [];
  const herd = new TrapHerd(scope, { prepareGroup: input => step.prepare(input) });
  const off = onFault(fault => { faults.push(fault); });
  try {
    herd.frame();
    expect(faults).toStrictEqual([]);
    const first = 1 + oracle.next();
    expect(Array.from(herd.bank)).toStrictEqual([first, 0]);
    expect(herd.published).toBe(first);
    expect(herd.commits).toBe(1);
    const bank = herd.bank.slice(), entropy = herd.random.snapshot();
    for (const signal of TRAPS) {
      herd.signal = signal;
      expect(() => { herd.frame(); }).not.toThrow();
      expect(herd.bank).toStrictEqual(bank);
      expect(herd.random.snapshot()).toStrictEqual(entropy);
      expect(herd.commits).toBe(1);
      expect(herd.published).toBe(first);
    }
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ system: 'ai.group', verdict: 'retry' });
    expect(faults[0]?.error).toBeInstanceOf(WebAssembly.RuntimeError);
    herd.signal = 'advance';
    herd.frame();
    const next = first + 1 + oracle.next();
    expect(Array.from(herd.bank)).toStrictEqual([next, 0]);
    expect(herd.published).toBe(next);
    expect(herd.commits).toBe(2);
    expect(herd.random.snapshot()).toStrictEqual(oracle.snapshot());
    expect(faults).toHaveLength(1);
  } finally { off(); scope.dispose(); }
});

/** A one-horse herd with its shared and context RNG. `herd-rows.json` is Nalati's admitted herd bank, signals and two
 *  random streams, with no columns. */
function horseHerd(random: Rng, local: Rng): { herd: GrazerBrain<AnimalSim>; body: AnimalSim; context: GuardedHerdContext<AnimalSim> } {
  const body = new AnimalSim({ kind: 'horse', label: 'Horse', variant: 'leader', rarity: 'common', hp: 20, aggressive: false,
    dims: { bodyY: 0.6, bodyHalfLen: 0.5, bodyRadius: 0.3, headRadius: 0.2, legLen: 0.5, feet: [], halfWidth: 0.3 },
    mods: { speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 5, relentless: false } }, 1, 1, 'horse', { heightAt: () => 0, random: () => 0.5 });
  const context: GuardedHerdContext<AnimalSim> = { dt: 0.1, t: 2, player: new Vector3(1, 0, 3), playerSpeed: 0, calm: false, rng: local,
    sound: () => undefined, hurt: () => undefined, steer: () => undefined, pathYaw: () => 0, confine: () => undefined };
  const ports: GuardedHerdPorts<AnimalSim> = { sharedRng: () => random, environment: () => ({ playerMounted: false, playerCrouched: false }),
    visibility: () => 0, hearing: () => 0, downwind: () => false, inBounds: () => true, normalY: () => 1, passThrough: () => undefined,
    chargeContact: () => undefined, scarePack: () => false };
  const herd = new GrazerBrain([body], { pattern: 'herd', spec: { walkSpeed: 2, trotSpeed: 4, gallopSpeed: 7, chargeSpeed: 8, sightRadius: 40,
    grazingSightRadius: 20, coneAngle: 1, hearing: [1, 2, 3, 4], alertThreshold: 0.5, flightMinDistance: 20, flightMaxDistance: 40,
    stallionVariant: 'leader', foalPrefix: 'young', snortCue: 'snort', neighCue: 'neigh', squealCue: 'squeal' }, ports });
  return { herd, body, context };
}

test('a herd GrazerBrain whose bound guest traps on tick keeps the herd, body and RNG, and reports once', () => {
  const scope = new Scope('group-trap-grazer'), step = new GroupStepV2(herdBytes, herdRows, scope), faults: Fault[] = [];
  expect(step.layout.bytes).toBe(3008); // build.mjs compiles against this
  const random = new Rng(5), local = new Rng(7), { herd, body, context } = horseHerd(random, local), twin = horseHerd(new Rng(5), new Rng(7));
  // The guest's own `initialize` would run this module; the native one gives an initialized herd to restore instead.
  twin.herd.initialize();
  herd.bindGuest({ groupBindings: parseGroupStepV2(herdRows), prepareGroup: input => step.prepare(input) },
    { profile: 'main', parameters: {}, resume: { field: 'continuation', values: [0], segments: 4 } },
    { scope, group: 'herd', handle: 1, player: context.player, actors: [body] });
  herd.restore(twin.herd.snapshot());
  const off = onFault(fault => { faults.push(fault); });
  try {
    const saved = herd.snapshot(), pose = body.snapshot(), entropy = random.snapshot(), own = local.snapshot();
    for (let frame = 0; frame < 4; frame++) {
      context.t += 0.1;
      expect(() => { herd.tick(context); }).not.toThrow();
      expect(herd.snapshot()).toStrictEqual(saved);
      expect(body.snapshot()).toStrictEqual(pose);
      expect(random.snapshot()).toStrictEqual(entropy);
      expect(local.snapshot()).toStrictEqual(own);
    }
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ system: 'ai.group', verdict: 'retry' });
    expect(faults[0]?.error).toBeInstanceOf(WebAssembly.RuntimeError);
  } finally { off(); scope.dispose(); }
});
