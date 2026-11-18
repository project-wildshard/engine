import { createHash } from 'node:crypto';
import { AnimationClip, Bone, Group, MeshStandardMaterial } from 'three';
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { parseGlbData, prepareGlbCost } from '@wildshard/format/glbCost';
import type { SkinRow, SkinBinding } from '@wildshard/format/skinData';
import { Scope } from '@wildshard/engine/app/scope';
import { AnimMachine } from '@wildshard/engine/anim/machine';
import { bindRig } from '@wildshard/engine/anim/rig';
import { loadSkin } from '../src/client/game/shardfile/skinPlayback';
import { loadClientSkins, SkinDriver } from '../src/client/game/shardfile/clientSkins';
import { creatureVolumeFixture, creatureVolumeGlb } from './fixtures/creature-volume-skin';

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

test('a loaded rig can bind and play a named creature clip by its exact identity', () => {
  const attack = new AnimationClip('attack', 1, []), swing = new AnimationClip('swing', 1, []);
  const rig = bindRig(new Group(), [attack, swing], { skeleton: 'fixture.named', clips: ['attack', 'swing'], sockets: [] },
    { skeleton: 'fixture.named' });
  const machine = new AnimMachine({ states: { ability: { clip: 'swing', fade: 0 } } }, rig);
  try {
    machine.base('attack');
    machine.transition('ability');
    machine.update(.25);
    expect(machine.state).toBe('ability');
    expect(machine.action('swing').getClip()).toBe(swing);
    expect(machine.action('swing').time).toBeCloseTo(.25);
  } finally { machine.dispose(); }
});

const Doc = v.looseObject({ nodes: v.array(v.looseObject({ name: v.string() })), animations: v.array(v.looseObject({
  channels: v.array(v.looseObject({ sampler: v.number(), target: v.object({ node: v.number(), path: v.string() }) })),
})) });
/** Same real skin binary with two independently associated dotted joints and
 * two animation channels; the loader must retain their authored identities. */
function hands(collide = false, ambiguous = false): Uint8Array {
  const bytes = creatureVolumeGlb(), length = new DataView(bytes.buffer).getUint32(12, true);
  const doc = v.parse(Doc, JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))));
  const right = doc.nodes[3], left = doc.nodes[4], clip = doc.animations[0];
  if (right === undefined || left === undefined || clip === undefined) throw new Error('Missing actual fixture joints');
  right.name = collide ? 'handL' : 'hand.R';
  if (ambiguous) { const body = doc.nodes[1]; if (body === undefined) throw new Error('Missing actual root bone'); body.name = 'hand.L'; }
  clip.channels.push({ sampler: 0, target: { node: 4, path: 'translation' } });
  const json = Buffer.from(JSON.stringify(doc)), text = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const header = Buffer.from(bytes.subarray(0, 20)); header.writeUInt32LE(20 + text.length + bytes.length - 20 - length, 8); header.writeUInt32LE(text.length, 12);
  return Uint8Array.from(Buffer.concat([header, text, bytes.subarray(20 + length)]));
}
async function fixture(collide = false) {
  await prepareGlbCost();
  const glb = hands(collide), right = collide ? 'handL' : 'hand.R', joints = ['body', 'chest', right, 'hand.L'];
  const row: SkinRow = { id: 'fixture.skin', file: hash(glb), family: 'toon', rig: { skeleton: 'fixture.hands', joints: [joints], clips: ['idle'], sockets: [right, 'hand.L'] }, cost: parseGlbData(glb) };
  const binding: SkinBinding = { skin: row.id, material: { family: 'pbr', vertexColours: false }, loops: ['idle'] };
  return { glb, row, binding, right };
}

test.each([false, true])('real GLB keeps authored sockets and mixer channels; sanitized collision=%s', async collide => {
  const { glb, row, binding, right } = await fixture(collide), original = glb.slice(), material = new MeshStandardMaterial();
  const player = await loadSkin(glb, row, binding, material);
  try {
    expect(player.mesh.skeleton.bones.map(bone => bone.name)).toEqual(row.rig.joints[0]);
    expect(player.rig.sockets.get('hand.L')?.name).toBe('hand.L'); expect(player.rig.sockets.get(right)?.name).toBe(right);
    player.play('idle'); player.update(.5);
    expect(player.rig.sockets.get('hand.L')?.position.toArray()).toEqual([.5, 1, 0]);
    expect(player.rig.sockets.get(right)?.position.toArray()).toEqual([.5, 1, 0]);
    expect(glb).toEqual(original);
  } finally { player.dispose(); material.dispose(); }
});

test('real GLB sampled playback drives dotted bones after loading its hashed skin look', async () => {
  const { glb, row, binding } = await fixture(), { source } = await creatureVolumeFixture(), look = source.rows.looks[0];
  if (look === undefined) throw new Error('Missing actual skin look');
  const metadata = new TextEncoder().encode(JSON.stringify({ row, binding })), skinHash = hash(metadata);
  look.parameters = { skin: skinHash };
  const assets = new Map([[row.file, glb], [skinHash, metadata]]);
  source.files = [{ hash: row.file, kind: 'glb', compressed: glb.length, ...row.cost, dependencies: [], critical: false },
    { hash: skinHash, kind: 'json', compressed: metadata.length, decoded: metadata.length, gpu: 0, triangles: 0, draws: 0, dependencies: [row.file], critical: false }];
  const scope = new Scope('skin-names-proof');
  try {
    const skin = (await loadClientSkins(source, assets, () => new MeshStandardMaterial(), scope)).get(look.id);
    if (skin === undefined) throw new Error('Missing actually loaded skin');
    const bones: Record<string, Bone> = {};
    for (const def of skin.bones) { const bone = new Bone(); bone.name = def.name; bone.position.fromArray(def.pos); bones[def.name] = bone; }
    new SkinDriver(skin, bones).step({ dt: .5, t: .5, alive: true, flinch: 0, attack: -1, speed: 0, strafe: 0, scale: 1, phase: 0, state: 'idle' });
    expect(bones['hand.L']?.position.toArray()).toEqual([.5, 1, 0]); expect(bones['hand.R']?.position.toArray()).toEqual([.5, 1, 0]);
  } finally { scope.dispose(); }
});

test('renaming cannot hide a forged declared joint identity', async () => {
  const { glb, row, binding } = await fixture(), material = new MeshStandardMaterial();
  const joints = row.rig.joints[0]; if (joints === undefined) throw new Error('Missing actual joint table');
  row.rig.joints = [[...joints.slice(0, -1), 'forged']]; row.rig.sockets = [];
  try { await expect(loadSkin(glb, row, binding, material)).rejects.toThrow('skin joint order differs from bake'); }
  finally { material.dispose(); }
});

test('duplicate original joint names refuse before a sanitized alias can grant a socket', async () => {
  const { row, binding } = await fixture(), glb = hands(false, true), material = new MeshStandardMaterial();
  row.file = hash(glb); row.cost = parseGlbData(glb);
  try { await expect(loadSkin(glb, row, binding, material)).rejects.toThrow('ambiguous skin node hand.L'); }
  finally { material.dispose(); }
});
