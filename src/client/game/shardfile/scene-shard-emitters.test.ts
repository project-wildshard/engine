// FORMAT-PRUNE FP49: a scene shard (no world/scenes) runs `light.emitters` and `weather.fields`: its lights hang under the
// plan root, a row's gains follow a weather field, and the field reads the shard's declared quest.
import { expect, test } from 'vitest';
import { Group, PointLight, Vector3 } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { QuestState } from '@wildshard/engine/quest/core';
import { Flags } from '@wildshard/engine/world/interact/flags';
import { publishBoundQuest, publishDeclaredQuest, readableQuestState } from '../../../shared/game/quest/boundState';
import { EmitterPresentation, sceneShardEmitterHandles } from './lightEmitters';
import { sceneScalar } from './sceneInputs';
import type { ShardContext } from '../plugin/context';

const def = { id: 'fen.lit', title: 'Light the shrine', completeFlag: 'fen.lit', steps: [] };

test('a declared quest is readable by slug while its scope lives; an entry-bound quest wins', () => {
  const page = new Scope('fp49-page'), entry = new Scope('fp49-entry');
  try {
    expect(readableQuestState(entry, 'fen', def.id)).toBeUndefined();
    const declared = new QuestState(def, new Flags('fen'));
    publishDeclaredQuest('fen', page, declared);
    expect(readableQuestState(entry, 'fen', def.id)).toBe(declared);
    expect(readableQuestState(entry, 'other', def.id)).toBeUndefined();
    const bound = new QuestState(def, new Flags('fen'));
    publishBoundQuest(entry, bound);
    expect(readableQuestState(entry, 'fen', def.id)).toBe(bound);
    page.dispose();
    expect(readableQuestState(new Scope('fp49-next'), 'fen', def.id)).toBeUndefined();
  } finally { page.dispose(); entry.dispose(); }
});

test('a scene shard emitter hangs under the plan root and its light follows its field', () => {
  const scope = new Scope('fp49-emitters'), root = new Group();
  root.position.set(500, 0, 0);
  try {
    const ctx = { root, product: { slug: 'fp49-fen', shardfile: { state: { shared: [
      { id: 6501, name: 'fen.glow', type: 'f64', privacy: 'host', default: 0.25, min: 0, max: 1 },
    ] } } } } as unknown as ShardContext;
    const handles = sceneShardEmitterHandles(root, scope);
    const rows = { version: 1 as const, input: 'scene.emitters', clock: 'scene.emitter-clock', rows: [{
      id: 'fen.shrine', parent: 'scene', initially: true, draws: [], field: 'fen.glow',
      light: { at: { point: 'scene.origin', offset: [0, 4.6, -70] as [number, number, number] }, colour: 0x7f_e8_ff, gain: 16, distance: 22, decay: 2, shared: false, waves: [] },
    }] };
    const glow = sceneScalar('fp49-fen', 'fen.glow');
    glow.value = 0.25;
    const presentation = new EmitterPresentation(rows, handles, ctx, scope, new Map());
    const light = root.children.find((child): child is PointLight => child instanceof PointLight);
    expect(light?.position).toEqual(new Vector3(0, 4.6, -70));
    presentation.step(0, new Vector3());
    expect(light?.intensity).toBeCloseTo(4, 5);
    glow.value = 1;
    presentation.step(0, new Vector3());
    expect(light?.intensity).toBeCloseTo(16, 5);
    glow.value = 3;
    presentation.step(0, new Vector3());
    expect(light?.intensity).toBeCloseTo(16, 5);
    presentation.set('fen.shrine', false);
    presentation.step(0, new Vector3());
    expect(light?.intensity).toBe(0);
  } finally { scope.dispose(); }
});

test('an emitter refuses an undeclared field', () => {
  const scope = new Scope('fp49-refuse'), root = new Group();
  try {
    const ctx = { root, product: { slug: 'fp49-bare', shardfile: { state: { shared: [] } } } } as unknown as ShardContext;
    const rows = { version: 1 as const, input: 'scene.emitters', clock: 'scene.emitter-clock', rows: [{ id: 'lamp', parent: 'scene', initially: true, draws: [], field: 'missing' }] };
    expect(() => new EmitterPresentation(rows, sceneShardEmitterHandles(root, scope), ctx, scope, new Map())).toThrow('undeclared host field');
  } finally { scope.dispose(); }
});
