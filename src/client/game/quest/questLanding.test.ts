// @vitest-environment happy-dom
// meta MOSSGATE-ZONE MZ31 (QA 11-19 row 35, "I'm setting these lanterns and nothing happens"): a declared step lands at its
// place the frame its `done` first holds, a payoff lands bigger with the score's reward take and then the next goal, and
// what the save already finished stays quiet.
import { expect, test } from 'vitest';
import { Scene, Vector3 } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { QuestState } from '@wildshard/engine/quest/core';
import { Flags } from '@wildshard/engine/world/interact/flags';
import { installQuestLandings, type QuestLandingPorts } from './questLanding';

const LAMPLIGHTER = {
  id: 'lamp', title: 'Relight the Hollow', completeFlag: 'lamp.done', startWhen: { all: ['lamp.accepted'] },
  steps: [
    { id: 'a', objective: 'Light brazier A', done: { all: ['lamp.a'] }, feedback: { at: { x: 4, z: -6, y: 1 }, colour: '#ffa040', radius: 6, sound: 'ignite' as const } },
    { id: 'b', objective: 'Light brazier B', done: { all: ['lamp.b'] }, feedback: { at: { x: -9, z: 3 } } },
    { id: 'report', objective: 'Tell the Lamplighter', done: { all: ['lamp.reported'] } },
  ],
  onComplete: { fact: 'lamp', scene: 'lamp.payoff', payoff: { at: { x: 0, z: 2, y: 0.5 }, sound: 'glyph' as const, next: 'Ask the Pond Hermit about the gate' } },
};

function rig(): { ports: QuestLandingPorts; root: Scene; heard: string[]; tick: (dt: number) => void; settle: () => void } {
  const root = new Scene(), heard: string[] = [], frames: ((dt: number) => void)[] = [];
  let settle = (): void => undefined;
  const ports: QuestLandingPorts = {
    root, feet: () => new Vector3(0, 7, 0),
    sound: (sound, at) => { heard.push(`${sound}@${at.x},${at.y},${at.z}`); return true; },
    music: (name) => { heard.push(`music:${name}`); }, toast: (text) => { heard.push(`toast:${text}`); },
    settled: (then) => { settle = then; return () => undefined; },
    frame: (run) => { frames.push(run); },
  };
  return { ports, root, heard, tick: (dt) => { for (const run of frames) run(dt); }, settle: () => { settle(); } };
}

test('a step lands at its place once, its light spreads and frees itself; a payoff plays dawn and then the next goal', () => {
  const scope = new Scope('landing'), flags = new Flags('mossgate'), quest = new QuestState(LAMPLIGHTER, flags, undefined, scope);
  const { ports, root, heard, tick, settle } = rig();
  const landed = installQuestLandings([quest], ports, scope);
  settle(); flags.set('lamp.accepted'); tick(0.016);
  expect(landed).toEqual([]);
  flags.set('lamp.a'); tick(0.016);
  expect(landed).toEqual(['lamp/a']); expect(heard).toEqual(['ignite@4,1,-6']);
  const flare = root.getObjectByName('quest-landing');
  expect(flare?.position.toArray()).toEqual([4, 1, -6]);
  // the light has spread a second later, and is gone (meshes freed) by the end of its life
  const pool = flare?.children[1]; const early = pool?.scale.x ?? 0; tick(1);
  expect(pool?.scale.x ?? 0).toBeGreaterThan(early); expect(pool?.scale.x ?? 0).toBeGreaterThan(5);
  tick(3); expect(root.getObjectByName('quest-landing')).toBeUndefined();
  tick(0.016); expect(landed).toEqual(['lamp/a']);
  // a step with no height stands at the feet; the defaults are the engine's chime
  flags.set('lamp.b'); tick(0.016); expect(heard.at(-1)).toBe('chime@-9,7,3');
  flags.set('lamp.reported'); tick(0.016);
  expect(quest.isComplete).toBe(true); expect(landed).toEqual(['lamp/a', 'lamp/b', 'lamp/payoff']);
  expect(heard.slice(-2)).toEqual(['glyph@0,0.5,2', 'music:dawn']);
  expect(root.getObjectByName('quest-payoff')).toBeDefined();
  tick(2); expect(heard.some((h) => h.startsWith('toast:'))).toBe(false);
  tick(3); expect(heard.at(-1)).toBe('toast:Next · Ask the Pond Hermit about the gate');
  scope.dispose(); expect(root.children).toEqual([]);
});

test('what the save already finished stays quiet, and nothing lands before the wire settles', () => {
  const scope = new Scope('landing-save'), flags = new Flags('mossgate');
  const quest = new QuestState(LAMPLIGHTER, flags, undefined, scope);
  const { ports, heard, tick, settle } = rig();
  const landed = installQuestLandings([quest], ports, scope);
  // the wire mirrors the save on its first frame: accepted, A lit, the quest not yet done
  flags.set('lamp.accepted'); flags.set('lamp.a'); tick(0.016);
  expect(landed).toEqual([]);
  settle(); tick(0.016); expect(landed).toEqual([]);
  flags.set('lamp.b'); tick(0.016); expect(landed).toEqual(['lamp/b']); expect(heard).toEqual(['chime@-9,7,3']);
  scope.dispose();
});

test('a quest that starts with a step already done does not land it', () => {
  const scope = new Scope('landing-start'), flags = new Flags('mossgate');
  const quest = new QuestState(LAMPLIGHTER, flags, undefined, scope);
  const { ports, tick, settle } = rig();
  const landed = installQuestLandings([quest], ports, scope);
  settle(); flags.set('lamp.a'); tick(0.016); flags.set('lamp.accepted'); tick(0.016);
  expect(landed).toEqual([]);
  scope.dispose();
});
