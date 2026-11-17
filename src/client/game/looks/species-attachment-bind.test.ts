import { expect, test } from 'vitest';
import { Bone, BufferGeometry, Skeleton, SkinnedMesh } from 'three';

// ZONE-ENTRY ZE22 (staging v0.1.34): a packed look's attachment joined a rig already in a cell before it was bound, and the
// cell clip's childadded watch read `skeleton.bones` of undefined; every Nalati entry showed the error card.
test('a packed attachment is bound before it joins a rig already in the scene', async () => {
  const { wearAttachment } = await import('./speciesBook');
  const geometry = new BufferGeometry(), body = new SkinnedMesh(geometry);
  body.bind(new Skeleton([new Bone()]));
  const seen: number[] = [];
  body.addEventListener('childadded', ({ child }) => { if (child instanceof SkinnedMesh) seen.push(child.skeleton.bones.length); });
  const worn = wearAttachment(body, { name: 'tack', colour: [0.4, 0.3, 0.2], geometry });
  expect(seen).toEqual([1]);
  expect(worn.skeleton).toBe(body.skeleton);
  expect(worn.parent).toBe(body);
});
