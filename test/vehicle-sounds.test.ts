// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped physics module and reads the example's section.
import { readFileSync } from 'node:fs';
import { parseVehicles } from '@wildshard/format/vehicles';
import type { AudioData } from '@wildshard/format/audio';
import type { MoverPose } from '@wildshard/format/moverPose';
import { expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { vehicleAt, type VehicleWorld } from '../src/shared/engine/sim/vehicle';
import { installDeclaredAudio, type DeclaredAudioPorts } from '../src/client/engine/audio/declared';
import type { AudioLogEntry, AudioTally } from '../src/client/engine/audio/audioLog';
import { FollowedVehicles } from '../src/client/game/plugin/followedVehicles';
import { VehiclePrediction } from '../src/client/game/plugin/vehiclePrediction';
import { VEHICLE_SOUND, vehicleSoundSources, VehicleSounds, vehicleSynth, type VehicleHearing, type VehicleSoundOut, type VehicleSoundSource } from '../src/client/game/plugin/vehicleSounds';
import { playerVehicle, vehicleHornRow } from '../src/shared/game/shardfile/wirePrompts';
import { vehicleCommandOf } from '../src/shared/engine/sim/vehicleHull';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { VEHICLES_EXAMPLE } from './fixtures/vehiclesExample';

// MIRROR-SALT-ZONE MSZ15: a vehicle's sounds on a page. The engine loop's rate follows its speed, a slide across its heading
// starts a skid and its end stops it, and a hit plays one impact; each lands in the page's audio trigger log (`__audioLog`,
// `__audioTally`), the report a headless proof reads. A kind's `sounds` rows name `audio.cues`; a cue's voice is a declared
// recording or a material `impact-*` voice, and a slot left out plays the engine's synth.
const DT = 1 / 60;
const AUDIO: Pick<AudioData, 'cues' | 'recordings'> = {
  cues: [{ id: 'buggy.motor', voice: '/assets/sfx/salt/motor.m4a' }, { id: 'buggy.skid', voice: '/assets/sfx/salt/skid.m4a' }, { id: 'buggy.hit', voice: 'impact-stone' }],
  recordings: { '/assets/sfx/salt/motor.m4a': 'a'.repeat(64), '/assets/sfx/salt/skid.m4a': 'b'.repeat(64) },
};
interface HeardLoop { readonly source: VehicleSoundSource; readonly rates: number[]; readonly gains: number[]; stopped: boolean }
/** A mixer that keeps what it was asked to play. */
function fakeOut(): VehicleSoundOut & { readonly loops: HeardLoop[]; readonly shots: { source: VehicleSoundSource; rate: number; gain: number }[] } {
  const loops: HeardLoop[] = [], shots: { source: VehicleSoundSource; rate: number; gain: number }[] = [];
  return {
    loops, shots, listenerYaw: () => 0,
    loop: source => { const row: HeardLoop = { source, rates: [], gains: [], stopped: false }; loops.push(row); return { set: (rate, gain) => { row.rates.push(rate); row.gains.push(gain); }, stop: () => { row.stopped = true; } }; },
    shot: (source, rate, gain) => { shots.push({ source, rate, gain }); return true; },
  };
}
const report = (): { log: AudioLogEntry[]; tally: AudioTally } => {
  const page = window as unknown as { __audioLog: AudioLogEntry[]; __audioTally: AudioTally };
  return { log: page.__audioLog, tally: page.__audioTally };
};
const named = (name: string): AudioLogEntry[] => report().log.filter(row => row.kind === 'sfx' && row.name === name);

test('another player\'s buggy: its loop follows its speed, a slide skids and stops, a hit plays one impact', async () => {
  const vehicles = parseVehicles(JSON.parse(readFileSync(VEHICLES_EXAMPLE, 'utf8')));
  const buggyKind = vehicles.kinds.find(kind => kind.id === 'salt.buggy');
  if (buggyKind === undefined) throw new Error('the example has its buggy');
  buggyKind.sounds = { loop: 'buggy.motor', skid: 'buggy.skid', impact: 'buggy.hit' };
  const page = createSimHost({ ...SIM_LEVEL, entities: [], ground: { size: 400, height: 0 } }, { rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) });
  const scope = new Scope('vehicle-sounds-test'), out = fakeOut(), before = named('vehicle.impact').length;
  try {
    const followed = new FollowedVehicles(vehicles, { physics: page.physics, scope, sounds: { out, audio: AUDIO } });
    const buggy = playerVehicle('yard.buggy', 'actor.other'), ids = ['script:line.sail', `script:${buggy}`];
    // heading 0: forward is -z, right is +x
    let x = -6, z = 20, t = 0;
    const drive = (seconds: number, forward: (t: number) => number, right = 0): void => {
      for (let end = t + seconds; t < end - 1e-9; t += DT) {
        z -= forward(t) * DT; x += right * DT;
        const pose: MoverPose = { position: { x, y: 0, z }, euler: { x: 0, y: 0, z: 0 }, enabled: true };
        followed.view(buggy)?.pose(pose, {}); followed.sync(ids, 'actor.me', { x, z }); followed.frame(DT);
      }
    };
    const rate = (): number => followed.sound(buggy)?.loopRate ?? NaN;
    // away from rest to 20 m/s, then easing back to 10: the loop's rate climbs with the speed and falls with it
    drive(0.3, () => 0); const idle = rate();
    const rising: number[] = [];
    for (let i = 0; i < 8; i++) { drive(0.25, at => Math.min(20, 10 * (at - 0.3))); rising.push(rate()); }
    for (let i = 1; i < rising.length; i++) expect(rising[i]).toBeGreaterThanOrEqual((rising[i - 1] ?? 0) - 1e-6);
    const top = rate();
    drive(1.25, at => 20 - 8 * (at - 2.3)); const eased = rate();
    expect(idle).toBeCloseTo(0.7, 2);
    expect(top).toBeGreaterThan(idle + 0.8);
    expect(eased).toBeLessThan(top - 0.3);
    const engine = out.loops.find(row => row.source.kind === 'sample' && row.source.path === '/assets/sfx/salt/motor.m4a');
    expect(out.loops.filter(row => row.source.kind === 'synth' && row.source.synth === 'loop')).toHaveLength(1); // the parked sail's, which declares none
    expect(engine?.rates.at(-1)).toBeCloseTo(eased, 6);
    // a slide 4 m/s across its heading skids; running straight again stops it
    drive(0.6, () => 10, 4);
    expect(followed.sound(buggy)?.skidding).toBe(true);
    drive(0.6, () => 10);
    expect(followed.sound(buggy)?.skidding).toBe(false);
    const skid = out.loops.filter(row => row.source.kind === 'sample' && row.source.path === '/assets/sfx/salt/skid.m4a');
    expect(skid).toHaveLength(1);
    expect(skid[0]?.stopped).toBe(true);
    // into a wall at 10 m/s, back off it at 3: one impact, through the kind's material voice, and none after
    drive(0.4, () => 10); drive(0.8, () => -3);
    expect(out.shots).toHaveLength(1);
    expect(out.shots[0]?.source).toEqual({ kind: 'voice', family: 'impact-stone' });
    expect(followed.sound(buggy)?.impacts).toBe(1);
    // the headless report lists them: the loop, the skid's start and end, one impact
    const { tally } = report();
    expect(tally['sfx vehicle.loop']?.played).toBeGreaterThanOrEqual(2); // the buggy's and the parked sail's
    expect(tally['sfx vehicle.skid']?.played).toBe(1);
    expect(tally['sfx vehicle.skid.end']?.played).toBe(1);
    expect(named('vehicle.impact')).toHaveLength(before + 1);
    expect(named('vehicle.impact').at(-1)?.detail).toMatch(/^salt\.buggy yard\.buggy:actor\.other 1\d\.\d m\/s impact-stone$/u);
    // its driver holds the horn: the server's row sounds it on this page while it is up
    followed.sync([...ids, `state:${vehicleHornRow(buggy)}`], 'actor.me', { x, z }); followed.frame(DT);
    expect(followed.sound(buggy)?.horn).toBe(true);
    followed.sync(ids, 'actor.me', { x, z }); followed.frame(DT);
    expect(followed.sound(buggy)?.horn).toBe(false);
    // its row leaves: it goes quiet
    followed.sync(['script:line.sail'], 'actor.me', { x, z }); followed.frame(DT);
    expect(engine?.stopped).toBe(true);
  } finally { scope.dispose(); page.dispose(); }
});

test('the driven vehicle: its prediction hears its hits, the wind rushes past 20 m/s, the throttle lifts the loop, the horn sounds held', () => {
  // a straight road with a wall across it at z -40 (as vehicle-predict.test.ts drives)
  const road: VehicleWorld = {
    floor: () => 0, bow: 1.7, stern: 1.7, side: 0.95,
    hit: (from, move) => {
      const front = from.z - 1.7; if (move.z >= 0 || front + move.z > -40) return null;
      return { at: Math.max(0, (front + 40) / -move.z), normal: { x: 0, z: 1 }, owner: 'wall', mass: Infinity, velocity: { x: 0, z: 0 }, restitution: 0.35 };
    },
  };
  const handling = { speed: 22, reverse: 6, accel: 9, brake: 18, turn: 1.6, grip: 0.8, drift: 0.4, boost: 1.5, mass: 600, ground: true };
  const run = new VehiclePrediction(handling, road, vehicleAt({ x: 0, y: 0, z: 0 }, 0)), hits: number[] = [];
  for (let i = 0; i < 300; i++) { run.step({ throttle: 1, turn: 0, boost: false }); const hit = run.takeImpact(); if (hit > 0) hits.push(hit); }
  expect(hits.length).toBeGreaterThanOrEqual(1);
  expect(hits[0]).toBeGreaterThan(VEHICLE_SOUND.impactFrom);
  // the page hears it: one impact a hit, and the wind, the throttle and the horn from the seat
  const out = fakeOut(), sounds = new VehicleSounds(out, kind => vehicleSoundSources(kind, AUDIO));
  const kind = { id: 'salt.buggy', sounds: { loop: 'buggy.motor', impact: 'buggy.hit' }, handling: { speed: 22 } };
  const hear = (forward: number, extra: Partial<VehicleHearing> = {}): void => {
    sounds.frame(DT, [{ id: 'mine', kind, at: { x: 0, y: 0, z: 0 }, forward, slip: 0, throttle: 0, impact: 0, horn: false, aboard: true, ...extra }], { x: 0, z: 0 });
  };
  hear(10); const coasting = sounds.state('mine')?.loopRate ?? 0;
  hear(10, { throttle: 1 }); expect(sounds.state('mine')?.loopRate).toBeGreaterThan(coasting + 0.15);
  hear(10, { impact: hits[0] ?? 0 }); hear(10, { impact: hits[0] ?? 0 });
  expect(out.shots).toHaveLength(1); // the second step of the same bounce is the same hit
  hear(19); expect(sounds.state('mine')?.rushing).toBe(false);
  hear(VEHICLE_SOUND.windOn + 1); expect(sounds.state('mine')?.rushing).toBe(true);
  hear(19); expect(sounds.state('mine')?.rushing).toBe(true); // it dies away under 18, not at once
  hear(17); expect(sounds.state('mine')?.rushing).toBe(false);
  hear(10, { horn: true }); expect(sounds.state('mine')?.horn).toBe(true);
  hear(10); expect(sounds.state('mine')?.horn).toBe(false);
  const wind = out.loops.filter(row => row.source.kind === 'synth' && row.source.synth === 'wind'), horn = out.loops.filter(row => row.source.kind === 'synth' && row.source.synth === 'horn');
  expect(wind).toHaveLength(1); expect(wind[0]?.stopped).toBe(true);
  expect(horn).toHaveLength(1); expect(horn[0]?.stopped).toBe(true);
  expect(report().tally['sfx vehicle.wind']?.played).toBeGreaterThanOrEqual(1);
  expect(report().tally['sfx vehicle.horn']?.played).toBeGreaterThanOrEqual(1);
  sounds.dispose();
  expect(out.loops.every(row => row.stopped)).toBe(true);
});

test('the horn button reaches the vehicle\'s command, which the server puts on the wire', () => {
  const base = { seq: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, sprint: false, fire: false } as unknown as Parameters<typeof vehicleCommandOf>[0];
  expect(vehicleCommandOf({ ...base, horn: true }, 0).horn).toBe(true);
  expect(vehicleCommandOf(base, 0).horn).toBeUndefined();
});

test('a kind\'s sounds resolve through its cues: a recording, a material voice, or the engine\'s own', () => {
  const sources = vehicleSoundSources({ sounds: { loop: 'buggy.motor', impact: 'buggy.hit', horn: 'nowhere' } }, AUDIO);
  expect(sources.loop).toEqual({ kind: 'sample', path: '/assets/sfx/salt/motor.m4a', synth: 'loop' });
  expect(sources.impact).toEqual({ kind: 'voice', family: 'impact-stone' });
  expect(sources.skid).toEqual({ kind: 'synth', synth: 'skid' });
  expect(sources.horn).toEqual({ kind: 'synth', synth: 'horn' });
  expect(vehicleSoundSources({}, AUDIO).impact).toEqual({ kind: 'voice', family: 'impact-wood' });
  // the engine's own loops loop clean, and never clip
  for (const synth of ['loop', 'skid', 'horn', 'wind'] as const) {
    const samples = vehicleSynth(synth, 48_000);
    expect(Math.max(...samples.map(Math.abs))).toBeLessThan(1);
    // the loop's seam: its last sample runs on into its first as any two neighbours do
    const steps = samples.slice(1).map((value, i) => Math.abs(value - (samples[i] ?? 0)));
    expect(Math.abs((samples[0] ?? 0) - (samples.at(-1) ?? 0))).toBeLessThanOrEqual(Math.max(...steps) + 1e-6);
  }
});

test('a cue naming a declared recording is left to its owner, not refused as an unknown catalogue voice', () => {
  const routed: ((id: string, opts: object) => boolean)[] = [], played: string[] = [], scope = new Scope('vehicle-sound-cues');
  const ports = {
    audio: { installSynthBed: () => undefined, restartSynthBed: () => undefined, installCues: () => undefined, mkWind: () => ({ disconnect: () => undefined }) },
    cues: { use: (map: (id: string, opts: object) => boolean) => { routed.push(map); } },
    voices: new Map([['impact-stone', () => { played.push('impact-stone'); }]]),
    music: { silence: () => undefined }, scope,
  } as unknown as DeclaredAudioPorts;
  try {
    installDeclaredAudio({ ...AUDIO, ambience: null, score: 'default' }, ports);
    expect(routed[0]?.('buggy.hit', {})).toBe(true);
    expect(routed[0]?.('buggy.motor', {})).toBe(false);
    expect(played).toEqual(['impact-stone']);
    expect(() => { installDeclaredAudio({ cues: [{ id: 'x', voice: 'nowhere' }], ambience: null, score: 'default' }, ports); }).toThrow(/Unknown catalogue voice: nowhere/u);
  } finally { scope.dispose(); }
});
