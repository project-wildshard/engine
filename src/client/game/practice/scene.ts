import * as THREE from 'three';
import { DevKit, devLabel, devMaterial } from '@wildshard/engine/practice/playground/devGrid';
import type { RoomMap, RoomShape } from '@wildshard/engine/ui/roomMap';
import type { ColliderDesc } from '@wildshard/engine/world/registry';
import type { PracticeScene } from '@wildshard/format/practiceCourseRows';

/** Client-only presenter. Both room types declare geometry and maps as local rows; no shard hooks are accepted. */
export function buildPracticeScene(row: PracticeScene, origin: THREE.Vector3, name: string): { root: THREE.Group; colliders: ColliderDesc[]; map: RoomMap } {
  const kit = new DevKit(), extra: THREE.Object3D[] = [];
  for (const part of row.parts) {
    const [x, y, z] = part.at, wx = x + origin.x, wy = y + origin.y, wz = z + origin.z;
    if (part.kind === 'box') kit.box(part.tone, wx, wy, wz, ...part.size, part.tint);
    else if (part.kind === 'plane') kit.plane(part.tone, wx, wy, wz, ...part.size);
    else if (part.kind === 'wall') kit.wall(part.tone, wx, wy, wz, ...part.size, part.face);
    else if (part.kind === 'label') {
      const label = devLabel(part.text, part.width, { ...(part.color === undefined ? {} : { color: part.color }), ...(part.back === undefined ? {} : { back: part.back }), ...(part.standing === undefined ? {} : { standing: part.standing }) });
      label.position.set(wx, wy, wz); label.rotation.y = part.yaw; extra.push(label);
    } else if (part.kind === 'checker') {
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 256;
      const context = canvas.getContext('2d');
      if (context !== null) for (let r = 0; r < 16; r++) for (let k = 0; k < 2; k++) { context.fillStyle = (r + k) % 2 === 0 ? '#f2f4f6' : '#15191e'; context.fillRect(k * 16, r * 16, 16, 16); }
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.NearestFilter;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, part.length).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: texture, fog: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      mesh.position.set(wx, wy, wz); extra.push(mesh);
    } else {
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.position, 3));
      if (part.uv !== undefined) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(part.uv, 2));
      if (part.color !== undefined) geometry.setAttribute('color', new THREE.Float32BufferAttribute(part.color, 3));
      if (part.index !== undefined) geometry.setIndex(part.index);
      const m = part.material, material = m.tone === undefined ? new THREE.MeshBasicMaterial({ color: m.color, fog: false }) : devMaterial(m.tone).clone();
      material.side = m.side; material.toneMapped = m.toneMapped; material.polygonOffset = m.polygonOffset; material.polygonOffsetFactor = m.polygonOffsetFactor;
      const mesh = new THREE.Mesh(geometry, material); mesh.name = part.name;
      // Baked ribbon UVs use world metres, like the developer grid around them.
      if (m.tone !== undefined && part.uv !== undefined) { const uv = geometry.getAttribute('uv'); for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + origin.x / 4, uv.getY(i) - origin.z / 4); }
      mesh.position.set(wx, wy, wz); mesh.rotation.set(...part.rotation); extra.push(mesh);
    }
  }
  const root = kit.build(name); root.add(...extra);
  const colliders: ColliderDesc[] = row.colliders.map(collider => ({ kind: collider.kind, x: collider.x + origin.x, y: collider.y + origin.y, z: collider.z + origin.z, hx: collider.hx, hy: collider.hy, hz: collider.hz, ...(collider.surface === undefined ? {} : { surface: collider.surface }) }));
  const b = row.map.bounds, shapes: RoomShape[] = [];
  for (const shape of row.map.shapes) {
    if (shape.kind === 'rect' || shape.kind === 'grid') shapes.push({ ...shape, x0: shape.x0 + origin.x, x1: shape.x1 + origin.x, z0: shape.z0 + origin.z, z1: shape.z1 + origin.z });
    else if (shape.kind === 'path') shapes.push({ ...shape, pts: shape.pts.map(([x, z]): [number, number] => [x + origin.x, z + origin.z]) });
    else shapes.push({ ...shape, x: shape.x + origin.x, z: shape.z + origin.z });
  }
  return { root, colliders, map: { bounds: { x0: b.x0 + origin.x, x1: b.x1 + origin.x, z0: b.z0 + origin.z, z1: b.z1 + origin.z }, shapes } };
}
