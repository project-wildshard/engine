import { expect, test } from 'vitest';
import { Bone, BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, Frustum, Matrix4, MeshBasicMaterial, PerspectiveCamera, Skeleton, SkinnedMesh, Vector3, type Object3D } from 'three';
import { FAR_SLOT_DATA, FarHerd } from './farHerd';
import { noteFrameDrawn } from '../../../shared/engine/core/framePacing';

function isSkinnedMesh(object: Object3D | undefined): object is SkinnedMesh { return object instanceof SkinnedMesh; }

function geometry(verts: number, indexed: boolean): BufferGeometry {
  const source = new BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['skinWeight', 4]] as const) {
    source.setAttribute(name, new Float32BufferAttribute(new Float32Array(verts * size), size));
  }
  source.setAttribute('skinIndex', new BufferAttribute(new Uint8Array(verts * 4), 4));
  source.setAttribute('color', new BufferAttribute(new Uint8Array(verts * 4).fill(255), 4, true));
  if (indexed) source.setIndex(new BufferAttribute(new Uint16Array(verts), 1));
  return source;
}

test.each([[true, 5000, 16], [false, 5000, 8]] as const)(
  'presenting=%s retains capacity for %s vertices', (paced, verts, slots) => {
    noteFrameDrawn(paced ? performance.now() : Number.NEGATIVE_INFINITY);
    const source = geometry(verts, false), material = new MeshBasicMaterial(), mesh = new SkinnedMesh(source, material);
    mesh.bind(new Skeleton([new Bone()])); const herd = new FarHerd(() => material);
    try {
      herd.begin(null); expect(herd.take({ mesh, tint: new Color() }, new Vector3(), 1)).toBe(true); herd.end();
      const page = herd.group.children[0]; if (!isSkinnedMesh(page)) throw new Error('Missing page');
      expect(page.geometry.getAttribute('position').count).toBe(verts * slots);
    } finally { herd.dispose(); mesh.skeleton.dispose(); source.dispose(); material.dispose(); noteFrameDrawn(Number.NEGATIVE_INFINITY); }
  });

// pages a herd will need open when its animals spawn (shown with an empty range, so the entry warm-up's draws upload
// them), not one a frame after the region activates; a member then takes a reserved page
test('reserved members open their pages ahead and take them later', () => {
  noteFrameDrawn(performance.now());
  const source = geometry(64, true), material = new MeshBasicMaterial(), herd = new FarHerd(() => material);
  const rigs = Array.from({ length: 17 }, () => { const mesh = new SkinnedMesh(source, material); mesh.bind(new Skeleton([new Bone()])); return { mesh, tint: new Color() }; });
  try {
    for (const rig of rigs) herd.reserve(rig);
    const again = rigs[0]; if (again !== undefined) herd.reserve(again); // counted once
    expect(herd.pageCount()).toBe(2);
    const first = herd.group.children[0]; if (!isSkinnedMesh(first)) throw new Error('Missing page');
    expect(first.visible).toBe(true); expect(first.geometry.drawRange.count).toBe(1);
    herd.begin(null);
    for (const rig of rigs) expect(herd.take(rig, new Vector3(), 1)).toBe(true);
    herd.end();
    expect(herd.pageCount()).toBe(2);
    for (const rig of rigs) herd.unreserve(rig);
    herd.begin(null); herd.end();
    expect(herd.pageCount()).toBe(2); expect(first.visible).toBe(false);
  } finally { herd.dispose(); for (const rig of rigs) rig.mesh.skeleton.dispose(); source.dispose(); material.dispose(); noteFrameDrawn(Number.NEGATIVE_INFINITY); }
});

// PF7: a view page is culled per camera by a sphere round its members (the manager's own cull is by azimuth only), and a
// reserved page with no members yet stays in every frustum, so the entry warm-up still uploads it
test('view pages cull by their members, and an empty reserved page still uploads', () => {
  noteFrameDrawn(performance.now());
  const source = geometry(64, true), material = new MeshBasicMaterial(), herd = new FarHerd(() => material);
  const mesh = new SkinnedMesh(source, material); mesh.bind(new Skeleton([new Bone()]));
  const rig = { mesh, tint: new Color() }, camera = new PerspectiveCamera(60, 1, 0.1, 500), frustum = new Frustum();
  camera.position.set(0, 2, 0); camera.lookAt(0, 2, -10); camera.updateMatrixWorld();
  frustum.setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  try {
    herd.reserve(rig);
    const page = herd.group.children[0]; if (!isSkinnedMesh(page)) throw new Error('Missing page');
    expect(page.frustumCulled).toBe(true); expect(frustum.intersectsObject(page)).toBe(true);
    herd.begin(null); herd.take(rig, new Vector3(0, 0, -60), 2); herd.end();
    expect(frustum.intersectsObject(page)).toBe(true);
    herd.begin(null); herd.take(rig, new Vector3(0, 0, 60), 2); herd.end();
    expect(page.visible).toBe(true); expect(frustum.intersectsObject(page)).toBe(false);
  } finally { herd.dispose(); mesh.skeleton.dispose(); source.dispose(); material.dispose(); noteFrameDrawn(Number.NEGATIVE_INFINITY); }
});

// PF7b: a coat family's batch holds members of several coats, each slot's data (its coat layer, its colours) on its own
// data bone after the skinning bones, each vertex pointing at its slot's
test('a slotted batch gives each slot a data bone holding its member data', () => {
  noteFrameDrawn(performance.now());
  const source = geometry(4, true), material = new MeshBasicMaterial(), family = {};
  const herd = new FarHerd<{ mesh: SkinnedMesh; tint: Color; slotData: readonly number[] }>(() => material, { keyOf: () => family });
  const rigs = [0, 2, 1].map((layer) => { const mesh = new SkinnedMesh(source, material); mesh.bind(new Skeleton([new Bone()])); return { mesh, tint: new Color(), slotData: [layer, 0.5] }; });
  try {
    herd.begin(null); for (const rig of rigs) expect(herd.take(rig, new Vector3(), 1)).toBe(true); herd.end();
    expect(herd.group.children).toHaveLength(1);
    const page = herd.group.children[0]; if (!isSkinnedMesh(page)) throw new Error('Missing page');
    const at = page.geometry.getAttribute(FAR_SLOT_DATA), cap = page.skeleton.bones.length / 2;
    expect([0, 4, 8].map((v) => at.getX(v))).toEqual([cap, cap + 1, cap + 2]);
    expect([0, 1, 2].map((s) => page.skeleton.bones[cap + s]?.matrixWorld.elements.slice(0, 2))).toEqual([[0, 0.5], [2, 0.5], [1, 0.5]]);
  } finally { herd.dispose(); for (const rig of rigs) rig.mesh.skeleton.dispose(); source.dispose(); material.dispose(); noteFrameDrawn(Number.NEGATIVE_INFINITY); }
});

// PF13: a family whose members came and went drew from two half-empty pages; members that stay in view move to an
// earlier page with room, one a frame, until the last page empties (one draw fewer), each keeping its bones and tint
test('members gather on the earliest pages, one a frame, and the emptied page stops drawing', () => {
  noteFrameDrawn(performance.now());
  const source = geometry(64, true), material = new MeshBasicMaterial(), herd = new FarHerd(() => material);
  const rigs = Array.from({ length: 20 }, (_, i) => { const mesh = new SkinnedMesh(source, material); mesh.bind(new Skeleton([new Bone()])); return { mesh, tint: new Color(i / 20, 0.5, 0.25) }; });
  const frame = (members: typeof rigs): void => { herd.begin(null); for (const rig of members) expect(herd.take(rig, new Vector3(), 1)).toBe(true); herd.end(); };
  const page = (i: number): SkinnedMesh => { const p = herd.group.children[i]; if (!isSkinnedMesh(p)) throw new Error('Missing page'); return p; };
  try {
    for (const rig of rigs) herd.reserve(rig);
    frame(rigs); // 16 + 4
    const stay = rigs.slice(10); // 6 on the first page leave; 6 + 4 stay
    frame(stay);
    expect(page(1).visible).toBe(true);
    for (let i = 0; i < 4; i++) frame(stay);
    expect(page(1).visible).toBe(false); expect(page(0).geometry.drawRange.count).toBe(10 * 64);
    // every member draws its own tint from its slot on the first page
    const color = page(0).geometry.getAttribute('color'), drawn = new Set<string>();
    for (let s = 0; s < 10; s++) drawn.add(color.getX(s * 64).toFixed(3));
    expect(drawn).toEqual(new Set(stay.map(rig => (rig.tint.r).toFixed(3))));
  } finally { herd.dispose(); for (const rig of rigs) rig.mesh.skeleton.dispose(); source.dispose(); material.dispose(); noteFrameDrawn(Number.NEGATIVE_INFINITY); }
});
