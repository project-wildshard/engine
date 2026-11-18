// ONE-FORMAT CC30c: a body's attachments on every species' page body. An axe rides hand.R; a `desktop` attachment is
// absent on the phone tier; `when` shows one by its channel; a broken plate's attachment hides on a remote page.
import { expect, test } from 'vitest';
import { Bone, BoxGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import type { CreatureBody } from '@wildshard/format/creatureLayers';
import { AttachmentRig } from '@wildshard/engine/entities/creatureAttachments';
import { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import { speciesAttachments } from './clientAttachments';

const AXE = 'a'.repeat(64), PLATE = 'b'.repeat(64);
const body: CreatureBody = {
  skeleton: 'biped', size: 'medium', scale: 1, look: 'mech.look',
  channels: [{ name: 'rage' }, { name: 'plate' }],
  volumes: [{ part: 'plate', bone: 'chest', shape: 'sphere', radius: 0.4, halfLength: 0, axis: 'y', multiplier: 0, hp: 30, channel: 'plate' }],
  attachments: [
    { id: 'axe', socket: 'hand.R', meshes: [{ id: 'axe.mesh', geometry: AXE, material: 'iron' }], at: [0, 0.1, 0] },
    { id: 'plate', socket: 'chest', meshes: [{ id: 'plate.mesh', geometry: PLATE, material: 'iron' }], part: 'plate' },
    { id: 'horns', socket: 'mouth', meshes: [{ id: 'horns.mesh', geometry: AXE, material: 'iron' }], when: { channel: 'rage' }, desktop: true },
  ],
};
const model = (): Group => { const group = new Group(); group.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial())); return group; };
const models = new Map([[AXE, model()], [PLATE, model()]]), materials = new Map([['iron', new MeshStandardMaterial()]]);

function skeleton(): { root: Group; find: (name: string) => Object3D | undefined } {
  const root = new Group();
  for (const name of ['chest', 'head', 'hand.R']) { const bone = new Bone(); bone.name = name; root.add(bone); }
  return { root, find: name => root.getObjectByName(name) };
}

test('an axe rides hand.R, and a desktop attachment is absent on the phone tier', () => {
  const desktop = speciesAttachments(body, models, materials, false), phone = speciesAttachments(body, models, materials, true);
  expect(desktop.map(row => row.id)).toEqual(['axe', 'plate', 'horns']);
  expect(phone.map(row => row.id)).toEqual(['axe', 'plate']);
  // `mouth` is the head bone with its socket offset
  expect(desktop[2]).toMatchObject({ bone: 'head', at: [0, 0, 0.2], when: { index: 0, at: 0.5 } });
  const { find } = skeleton(), rig = new AttachmentRig(phone, find);
  const axe = find('hand.R')?.children[0];
  expect(axe?.name).toBe('axe'); expect(axe?.position.toArray()).toEqual([0, 0.1, 0]);
  expect(find('head')?.children).toEqual([]);
  rig.dispose(); expect(find('hand.R')?.children).toEqual([]);
});

test('when shows by channel, and a broken plate hides on a remote page', () => {
  const { find } = skeleton(), rig = new AttachmentRig(speciesAttachments(body, models, materials, false), find);
  const page = new AnimalSim({ kind: 'mech', label: 'Mech', variant: 'plain', rarity: 'common', hp: 100, aggressive: true,
    dims: { bodyY: 1, bodyHalfLen: 0.5, bodyRadius: 0.3, headRadius: 0.3, legLen: 0.5, feet: [], halfWidth: 0.4 },
    mods: { speed: 1, chargeDist: 1, chargeDamage: 0, damageTaken: 1, relentless: false }, channels: [0, 0] }, 1, 1, 'mech', { heightAt: () => 0, random: () => 0.5 });
  const visible = (name: string): boolean | undefined => find(name === 'horns' ? 'head' : name === 'axe' ? 'hand.R' : 'chest')?.getObjectByName(name)?.visible;
  rig.update(page.channels);
  expect([visible('axe'), visible('plate'), visible('horns')]).toEqual([true, true, false]);
  const row = { x: 0, y: 0, z: 0, yaw: 0, state: 'idle' as const, attack: 0, flinch: 0, strafe: 0, brace: 0, hp: 100, alive: true, rise: 0, act: 0 };
  page.showRow({ ...row, channels: [0.7, 1, 0, 0] }, 0); rig.update(page.channels);
  expect([visible('axe'), visible('plate'), visible('horns')]).toEqual([true, false, true]);
});

test('an unknown bone or an unloaded part refuses', () => {
  expect(() => speciesAttachments(body, new Map(), materials, false)).toThrow('Unloaded creature attachment geometry');
  expect(() => speciesAttachments(body, models, new Map(), false)).toThrow('Missing creature attachment material iron');
  expect(() => new AttachmentRig(speciesAttachments(body, models, materials, false), () => undefined)).toThrow('Missing creature attachment bone');
});
