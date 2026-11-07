import { expect, test } from 'vitest';
import { Bone, BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, InstancedMesh, Mesh, MeshBasicMaterial, PCFShadowMap, PerspectiveCamera, Scene, Skeleton,
  SkinnedMesh, Uint16BufferAttribute, Vector4, WebGLRenderTarget, type Camera, type Material, type Object3D } from 'three';
import { warmParkedDraws, type ParkedDrawBudget, type ParkedDrawRenderer } from './parkedDraws';
import { drawNeutral } from './drawNeutral';

/** The slicing rules at one native unit a slice (the WebKit live budget before G782 raised it to two, D152). */
const ONE_UNIT: ParkedDrawBudget = { drawables: 8, newMaterials: 1, newBindings: 1, bufferBytes: 256 * 1024 };

const ONE_A_SLICE: ParkedDrawBudget = { drawables: 1, newMaterials: 1 };

/** A renderer double with three's property store: a draw gives each drawn material (of `materials`) a current program. */
function fixture(materials: readonly Material[]) {
  const scene = new Scene(), camera = new PerspectiveCamera(), root = new Group();
  scene.add(camera, root); root.visible = false;
  const target = new WebGLRenderTarget(4, 4), scissor = new Vector4();
  const properties = new WeakMap<object, { currentProgram?: { id: number } }>();
  let current: WebGLRenderTarget | null = null, scissorTest = false, program = 1;
  const draws: Object3D[][] = [];
  const plans: { original: number; selected: number }[] = [];
  const renderer: ParkedDrawRenderer & { properties: { get: (object: object) => { currentProgram?: { id: number } } } } = {
    properties: { get: object => { let row = properties.get(object); if (row === undefined) { row = {}; properties.set(object, row); } return row; } },
    render: (world: Object3D, view: Camera) => {
      const drawn: Object3D[] = [];
      world.traverseVisible(object => {
        if (!(object instanceof Mesh) || !object.layers.test(view.layers)) return;
        drawn.push(object);
        for (const material of materials) if (object.material === material) renderer.properties.get(material).currentProgram ??= { id: program++ };
      });
      draws.push(drawn);
    },
    shadowMap: { autoUpdate: true, needsUpdate: false, type: PCFShadowMap },
    getRenderTarget: () => current, setRenderTarget: value => {
      if (value === target) current = target;
      else if (value === null) current = null;
      else throw new Error('Unexpected preparation target');
    },
    getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    getScissor: value => value.copy(scissor), setScissor: () => undefined,
    getScissorTest: () => scissorTest, setScissorTest: value => { scissorTest = value; },
  };
  const warm = async (budget: ParkedDrawBudget = ONE_A_SLICE): Promise<{ drawn: number; pauses: number }> => {
    let pauses = 0;
    const drawn = await warmParkedDraws(renderer, scene, camera, target, root, () => true, () => { pauses++; return Promise.resolve(); },
      { budget, onPlan: (original, selected) => { plans.push({ original, selected }); } });
    return { drawn, pauses };
  };
  /** precompile's link: the material holds the program its entry draw will use before any parked draw */
  const compile = (material: Material, id: number): void => { renderer.properties.get(material).currentProgram = { id }; };
  return { root, draws, plans, warm, compile, dispose: () => { target.dispose(); } };
}

function uploadGeometry(bytes: number): BufferGeometry {
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(new Float32Array(bytes / 4), 3));
}
const isGeometry = (value: unknown): value is BufferGeometry => value instanceof BufferGeometry;

test('opaque upload packing reduces slices without changing any draw or byte/frame cap', async () => {
  const material = new MeshBasicMaterial(), f = fixture([material]);
  const geometries = [384, 288, 192, 96].map(uploadGeometry), objects = geometries.map(geometry => new Mesh(geometry, material));
  const budget: ParkedDrawBudget = { drawables: 8, newMaterials: 2, newBindings: 2, bufferBytes: 480 };
  try {
    f.compile(material, 7); f.root.add(...objects);
    expect(await f.warm(budget)).toEqual({ drawn: 4, pauses: 2 });
    expect(f.plans).toEqual([{ original: 3, selected: 2 }]);
    expect(f.draws).toEqual([[objects[0], objects[3]], [objects[1], objects[2]]]);
    expect(f.draws.flat()).toHaveLength(new Set(f.draws.flat()).size);
    for (const slice of f.draws) {
      expect(slice).toHaveLength(2);
      expect(slice.reduce((sum, object) => {
        const geometry: unknown = object instanceof Mesh ? object.geometry : undefined;
        return sum + (isGeometry(geometry) ? geometry.getAttribute('position').array.byteLength : 0);
      }, 0)).toBeLessThanOrEqual(480);
    }
  } finally { f.dispose(); for (const geometry of geometries) geometry.dispose(); material.dispose(); }
});

test('an oversized upload stays alone while smaller ordinary draws fill their original caps', async () => {
  const material = new MeshBasicMaterial(), f = fixture([material]);
  const geometries = [600, 384, 288, 192, 96].map(uploadGeometry), objects = geometries.map(geometry => new Mesh(geometry, material));
  try {
    f.compile(material, 7); f.root.add(...objects);
    expect(await f.warm({ drawables: 8, newMaterials: 2, newBindings: 2, bufferBytes: 480 })).toEqual({ drawn: 5, pauses: 3 });
    expect(f.plans).toEqual([{ original: 4, selected: 3 }]);
    expect(f.draws[0]).toEqual([objects[0]]);
    expect(new Set(f.draws.flat())).toEqual(new Set(objects));
  } finally { f.dispose(); for (const geometry of geometries) geometry.dispose(); material.dispose(); }
});

test('hooked and transparent draws preserve their cursor, including draw-neutral hooks', async () => {
  for (const barrier of ['hook', 'neutral', 'transparent'] as const) {
    const material = new MeshBasicMaterial(), special = new MeshBasicMaterial({ transparent: barrier === 'transparent' }), f = fixture([material, special]);
    const geometries = [384, 288, 192, 96].map(uploadGeometry), objects = geometries.map((geometry, i) => new Mesh(geometry, i === 1 ? special : material));
    const middle = objects[1]; if (middle === undefined) throw new Error('Missing warm barrier');
    if (barrier === 'hook') middle.onBeforeRender = () => undefined;
    if (barrier === 'neutral') middle.onBeforeRender = drawNeutral(() => undefined);
    try {
      f.compile(material, 7); f.compile(special, 7); f.root.add(...objects);
      expect(await f.warm({ drawables: 8, newMaterials: 2, newBindings: 2, bufferBytes: 480 })).toEqual({ drawn: 4, pauses: 3 });
      expect(f.plans).toEqual([{ original: 3, selected: 3 }]);
      expect(f.draws.flat()).toEqual(objects);
    } finally { f.dispose(); for (const geometry of geometries) geometry.dispose(); material.dispose(); special.dispose(); }
  }
});

test('packing cannot bypass distinct-program admission and keeps original order on a tied plan', async () => {
  const materials = Array.from({ length: 4 }, () => new MeshBasicMaterial()), f = fixture(materials);
  const geometries = [384, 288, 192, 96].map(uploadGeometry), objects = geometries.map((geometry, i) => new Mesh(geometry, materials[i]));
  try {
    materials.forEach((material, i) => f.compile(material, 10 + i)); f.root.add(...objects);
    expect(await f.warm({ drawables: 8, newMaterials: 1, newBindings: 1, bufferBytes: 480 })).toEqual({ drawn: 4, pauses: 4 });
    expect(f.plans).toEqual([{ original: 4, selected: 4 }]);
    expect(f.draws.flat()).toEqual(objects);
  } finally { f.dispose(); for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose(); }
});

test('a later parked warm of the same pipelines draws nothing new; a fresh geometry still draws', async () => {
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial(), other = new BoxGeometry(), f = fixture([material]);
  try {
    f.root.add(new Mesh(geometry, material), new InstancedMesh(geometry, material, 2));
    expect(await f.warm()).toEqual({ drawn: 2, pauses: 2 });
    // the destination is parked again with new wrappers over the same library geometry and material
    f.root.clear(); f.root.add(new Mesh(geometry, material));
    expect(await f.warm()).toEqual({ drawn: 0, pauses: 0 });
    f.root.add(new Mesh(other, material));
    expect((await f.warm()).drawn).toBe(1);
  } finally { f.dispose(); geometry.dispose(); other.dispose(); material.dispose(); }
});

test('a new instance buffer, a disposed material or a disposed geometry keeps its warm draw', async () => {
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial(), f = fixture([material]);
  try {
    f.root.add(new InstancedMesh(geometry, material, 2));
    expect((await f.warm()).drawn).toBe(1);
    f.root.clear(); f.root.add(new InstancedMesh(geometry, material, 2)); // same layout, its own instance matrices
    expect((await f.warm()).drawn).toBe(1);
    f.root.clear(); const mesh = new Mesh(geometry, material); f.root.add(mesh);
    expect((await f.warm()).drawn).toBe(1);
    expect((await f.warm()).drawn).toBe(0);
    material.dispose();
    expect((await f.warm()).drawn).toBe(1);
    geometry.dispose();
    expect((await f.warm()).drawn).toBe(1);
  } finally { f.dispose(); geometry.dispose(); material.dispose(); }
});

test('every drawn slice gets its own completed frame, under the live WebKit budget too', async () => {
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial(), f = fixture([material]);
  try {
    f.root.add(...Array.from({ length: 20 }, () => new InstancedMesh(geometry, material, 1)));
    // slices of 8, 8, 4 (copies share the binding's first use), a completed frame each
    const { drawn, pauses } = await f.warm(ONE_UNIT);
    expect(drawn).toBe(20);
    expect(pauses).toBe(3);
    expect(f.draws.map(slice => slice.length)).toEqual([8, 8, 4]);
  } finally { f.dispose(); geometry.dispose(); material.dispose(); }
});

test('fresh materials over an already built pipeline do not count as new; distinct programs still do', async () => {
  const shared = Array.from({ length: 8 }, () => new MeshBasicMaterial()), f = fixture(shared);
  const geometries = Array.from({ length: 8 }, () => new BoxGeometry());
  const budget: ParkedDrawBudget = { drawables: 8, newMaterials: 1 };
  try {
    // one program for four new materials: the first builds the pipeline, the other three ride it in the same slice
    for (const material of shared.slice(0, 4)) f.compile(material, 7);
    f.root.add(...shared.slice(0, 4).map((material, i) => new Mesh(geometries[i], material)));
    expect(await f.warm(budget)).toEqual({ drawn: 4, pauses: 1 });
    // the next crossing re-parks fresh geometries and materials over that program: drawn (new buffers), one slice
    f.root.clear();
    for (const material of shared.slice(4)) f.compile(material, 7);
    f.root.add(...shared.slice(4).map((material, i) => new Mesh(geometries[i + 4], material)));
    expect(await f.warm(budget)).toEqual({ drawn: 4, pauses: 1 });
    // four distinct programs: a slice each
    f.root.clear();
    const distinct = Array.from({ length: 4 }, () => new MeshBasicMaterial());
    distinct.forEach((material, i) => { f.compile(material, 20 + i); });
    f.root.add(...distinct.map(material => new Mesh(new BoxGeometry(), material)));
    expect(await f.warm(budget)).toEqual({ drawn: 4, pauses: 4 });
    for (const material of distinct) material.dispose();
  } finally { f.dispose(); for (const geometry of geometries) geometry.dispose(); for (const material of shared) material.dispose(); }
});

test('under the live WebKit budget, fresh geometry over a built pipeline is not a first use; a new program still is', async () => {
  const shared = Array.from({ length: 8 }, () => new MeshBasicMaterial()), f = fixture(shared);
  const geometries = Array.from({ length: 8 }, () => new BoxGeometry());
  try {
    for (const material of shared) f.compile(material, 7);
    f.root.add(...shared.slice(0, 4).map((material, i) => new Mesh(geometries[i], material)));
    expect(await f.warm(ONE_UNIT)).toEqual({ drawn: 4, pauses: 1 });
    f.root.clear(); f.root.add(...shared.slice(4).map((material, i) => new Mesh(geometries[i + 4], material)));
    expect(await f.warm(ONE_UNIT)).toEqual({ drawn: 4, pauses: 1 });
    f.root.clear();
    const distinct = Array.from({ length: 3 }, () => new MeshBasicMaterial());
    distinct.forEach((material, i) => { f.compile(material, 30 + i); });
    f.root.add(...distinct.map(material => new Mesh(new BoxGeometry(), material)));
    expect(await f.warm(ONE_UNIT)).toEqual({ drawn: 3, pauses: 3 });
    for (const material of distinct) material.dispose();
  } finally { f.dispose(); for (const geometry of geometries) geometry.dispose(); for (const material of shared) material.dispose(); }
});

test('skins over a built pipeline pace as copies; a per-object callback keeps a first use of its own', async () => {
  const material = new MeshBasicMaterial(), f = fixture([material]);
  const geometries: BoxGeometry[] = [];
  const skinned = (): SkinnedMesh => {
    const geometry = new BoxGeometry(), count = geometry.getAttribute('position').count; geometries.push(geometry);
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(new Float32Array(count * 4), 4));
    const mesh = new SkinnedMesh(geometry, material), bone = new Bone();
    mesh.add(bone); mesh.bind(new Skeleton([bone])); return mesh;
  };
  try {
    f.compile(material, 7);
    f.root.add(skinned(), skinned(), skinned());
    expect(await f.warm(ONE_UNIT)).toEqual({ drawn: 3, pauses: 1 });
    f.root.clear();
    const hooked = [new Mesh(new BoxGeometry(), material), new Mesh(new BoxGeometry(), material)];
    for (const mesh of hooked) { geometries.push(mesh.geometry); mesh.onBeforeRender = () => undefined; }
    f.root.add(...hooked);
    expect(await f.warm(ONE_UNIT)).toEqual({ drawn: 2, pauses: 2 });
  } finally { f.dispose(); for (const geometry of geometries) geometry.dispose(); material.dispose(); }
});

test('callbacks declared draw-neutral pace as copies; a wrapped unmarked hook does not', async () => {
  const material = new MeshBasicMaterial(), f = fixture([material]);
  const geometries = [new BoxGeometry(), new BoxGeometry(), new BoxGeometry()];
  try {
    f.compile(material, 7);
    const neutral = geometries.map(geometry => { const mesh = new Mesh(geometry, material); mesh.onBeforeRender = drawNeutral(() => undefined); return mesh; });
    f.root.add(...neutral);
    expect(await f.warm(ONE_UNIT)).toEqual({ drawn: 3, pauses: 1 });
    f.root.clear();
    const partly = new Mesh(new BoxGeometry(), material), hooked = new Mesh(new BoxGeometry(), material);
    partly.onBeforeRender = drawNeutral(() => undefined); partly.onAfterRender = () => undefined; // one unmarked hook keeps its own first use
    hooked.onBeforeRender = () => undefined;
    geometries.push(partly.geometry, hooked.geometry);
    f.root.add(partly, hooked);
    expect(await f.warm(ONE_UNIT)).toEqual({ drawn: 2, pauses: 2 });
  } finally { f.dispose(); for (const geometry of geometries) geometry.dispose(); material.dispose(); }
});

test('a known program under different blending is a new pipeline; the same state paces as a copy', async () => {
  const opaque = new MeshBasicMaterial(), copy = new MeshBasicMaterial(), blended = new MeshBasicMaterial({ transparent: true });
  const f = fixture([opaque, copy, blended]), geometries = [new BoxGeometry(), new BoxGeometry(), new BoxGeometry()];
  try {
    for (const material of [opaque, copy, blended]) f.compile(material, 7);
    f.root.add(new Mesh(geometries[0], opaque), new Mesh(geometries[1], copy), new Mesh(geometries[2], blended));
    // the opaque pair shares one slice (same program and state); the blended material builds its own pipeline
    expect(await f.warm(ONE_UNIT)).toEqual({ drawn: 3, pauses: 2 });
  } finally { f.dispose(); for (const geometry of geometries) geometry.dispose(); for (const material of [opaque, copy, blended]) material.dispose(); }
});
