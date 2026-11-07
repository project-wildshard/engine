import { expect, test, vi } from 'vitest';
import { BatchedMesh, Bone, Box3, BoxGeometry, PerspectiveCamera, Object3D, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Scene, ShaderLib, Skeleton, SkinnedMesh, Sprite, SpriteMaterial, Uint16BufferAttribute, Vector3, WebGLRenderer, type Material, type WebGLProgramParametersWithUniforms } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { cellClip } from '../src/client/game/grid/cellClip';
import { setInstanceEnvelope } from '../src/client/engine/render/instancedGeometry';
import { inspectGridDraw } from './helpers/gridDrawAudit';
import { installShadowMaterialOwnership } from '../src/client/engine/render/shadowMaterialOwnership';
import { AssetService } from '../src/client/engine/app/assets';
import type { Renderer } from '../src/client/engine/render/renderer';

function compiled(material: Material): WebGLProgramParametersWithUniforms {
  const input: object = { vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader, uniforms: {} };
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing renderer');
  const isProgram = (value: object): value is WebGLProgramParametersWithUniforms => 'vertexShader' in value && 'fragmentShader' in value && 'uniforms' in value;
  if (!isProgram(input)) throw new Error('Missing shader program');
  material.onBeforeCompile(input, renderer); return input;
}

test('all 25 authored cells admit bounded draws without shader variants, and catch a late stray', () => {
  const grid = new GridAssembly({ developer: true, devserver: true });
  expect(grid.cells).toHaveLength(25);
  const scene = new Scene(), scope = new Scope('containment'), shared = new MeshBasicMaterial();
  try {
    for (const cell of grid.cells) {
      const root = new Group(); root.name = `grid-cell:${cell.instance}`; root.position.set(cell.origin.x, 0, cell.origin.z); scene.add(root);
      const guard = cellClip(root, 250, scope); guard.sweep();
      const object = new Mesh(new BoxGeometry(2, 2, 2), shared); root.add(object);
      expect(object.material).toBe(shared);
      expect(guard.state().materials).toBe(0);
      const stray = new Mesh(new BoxGeometry(2, 40, 2), shared); stray.position.x = 250; root.add(stray);
      expect(stray.material).not.toBe(shared);
      const program = compiled(stray.material);
      expect(program.fragmentShader).toContain('discard');
      expect(program.uniforms['wsCellClip']?.value).toEqual(expect.objectContaining({ x: cell.origin.x - 250, z: cell.origin.x + 250 }));
      expect(guard.state()).toMatchObject({ meshes: 1, materials: 1, unclipped: 0 });
      expect(inspectGridDraw(stray, stray.material)?.issue).toBeNull();
      const saved = stray.material; stray.material = shared;
      expect(inspectGridDraw(stray, stray.material)?.issue).toBe('stray drawn object');
      stray.material = saved;
      root.traverse(node => { if (node instanceof Mesh) { const geometry: unknown = node.geometry; if (geometry instanceof BoxGeometry) geometry.dispose(); } });
    }
  } finally { scope.dispose(); shared.dispose(); }
});

test('aggregate instance bounds cross the edge even when the source geometry fits', () => {
  const scope = new Scope('instances'), root = new Group(), material = new MeshStandardMaterial(), geometry = new BoxGeometry(2, 2, 2);
  try {
    const mesh = new InstancedMesh(geometry, material, 2);
    mesh.setMatrixAt(1, new Matrix4().makeTranslation(255, 0, 0));
    root.add(mesh); const guard = cellClip(root, 250, scope); guard.sweep();
    expect(guard.state().meshes).toBe(1); expect(mesh.material).not.toBe(material);
    expect(compiled(material).fragmentShader).not.toContain('wsCellClip');
  } finally { scope.dispose(); material.dispose(); geometry.dispose(); }
});

test('an empty culled level is clipped by its declared envelope at admission, whichever copies it draws later', () => {
  const scope = new Scope('envelope'), root = new Group(), material = new MeshStandardMaterial(), geometry = new BoxGeometry(2, 2, 2);
  try {
    const level = new InstancedMesh(geometry, material, 2), inside = new InstancedMesh(geometry, material, 2);
    level.count = 0; inside.count = 0;
    setInstanceEnvelope(level, new Box3(new Vector3(-1, -1, -1), new Vector3(256, 1, 1)));
    setInstanceEnvelope(inside, new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)));
    root.add(level, inside); const guard = cellClip(root, 250, scope); guard.sweep();
    expect(level.material).not.toBe(material); expect(inside.material).toBe(material);
    const clipped = level.material;
    level.count = 1; level.instanceMatrix.needsUpdate = true; guard.update();
    expect(level.material).toBe(clipped);
  } finally { scope.dispose(); material.dispose(); geometry.dispose(); }
});

test('a culled caster inside its envelope skips copy checks; a crossing envelope keeps its copies test', () => {
  const scope = new Scope('caster-envelope'), root = new Group(), material = new MeshStandardMaterial(), geometry = new BoxGeometry(2, 2, 2);
  try {
    const inside = new InstancedMesh(geometry, material, 2), crossing = new InstancedMesh(geometry, material, 2);
    inside.castShadow = true; crossing.castShadow = true; inside.count = 0; crossing.count = 0;
    setInstanceEnvelope(inside, new Box3(new Vector3(-10, -1, -10), new Vector3(10, 1, 10)));
    setInstanceEnvelope(crossing, new Box3(new Vector3(-1, -1, -1), new Vector3(256, 1, 1)));
    root.add(inside, crossing); const guard = cellClip(root, 250, scope); guard.sweep();
    expect(inside.visible).toBe(true); expect(crossing.visible).toBe(true); expect(guard.state().refused).toBe(0);
    // the culler's per-frame copy choice: the inside draw queues nothing, the crossing one is checked by its copies
    inside.count = 2; inside.instanceMatrix.needsUpdate = true; expect(guard.changed()).toBe(false);
    crossing.count = 1; crossing.instanceMatrix.needsUpdate = true; expect(guard.changed()).toBe(true);
    guard.update(); expect(crossing.visible).toBe(true);
    crossing.setMatrixAt(0, new Matrix4().makeTranslation(251, 0, 0)); crossing.instanceMatrix.needsUpdate = true;
    guard.update(); expect(crossing.visible).toBe(false); expect(guard.state().refused).toBe(1);
    // a pose change still rechecks the enveloped draw
    inside.position.x = 245; expect(guard.changed()).toBe(true); guard.update(); expect(inside.visible).toBe(true); // envelope crosses, copies inside
    inside.position.x = 251; guard.update(); expect(inside.visible).toBe(false);
  } finally { scope.dispose(); material.dispose(); geometry.dispose(); }
});

test('moving a cell root cannot move its admitted fence or the authored-grid audit boundary', () => {
  const scope = new Scope('fixed-origin'), root = new Group(), geometry = new BoxGeometry(1, 1, 1), material = new MeshBasicMaterial();
  root.name = 'grid-cell:home'; const mesh = new Mesh(geometry, material); root.add(mesh);
  const guard = cellClip(root, 250, scope); guard.sweep();
  try {
    root.position.x = 300; guard.update(); expect(mesh.material).not.toBe(material);
    expect(compiled(mesh.material).uniforms['wsCellClip']?.value).toEqual(expect.objectContaining({ x: -250, z: 250 }));
    const centres = { home: { x: 0, z: 0 } };
    expect(inspectGridDraw(mesh, material, undefined, centres)?.issue).toBe('stray drawn object');
    expect(inspectGridDraw(mesh, mesh.material, undefined, centres)?.issue).toBeNull();
  } finally { scope.dispose(); geometry.dispose(); material.dispose(); }
});

test('a move after admission gets the clip before its next draw; unchanged draws do no new bounds work', () => {
  const scope = new Scope('moves'), root = new Group(), material = new MeshBasicMaterial(), geometry = new BoxGeometry(2, 2, 2);
  const mesh = new Mesh(geometry, material);
  try {
    root.add(mesh); const guard = cellClip(root, 250, scope); guard.sweep();
    guard.update();
    const before = guard.state().checked;
    expect(guard.changed()).toBe(false); guard.update();
    const sameYaw = mesh.rotation.y; mesh.rotation.y = sameYaw; mesh.quaternion.copy(mesh.quaternion);
    expect(guard.changed()).toBe(false);
    expect(guard.state().checked).toBe(before);
    mesh.position.z = -250; expect(guard.changed()).toBe(true);
    guard.update(); expect(guard.changed()).toBe(false);
    expect(guard.state().meshes).toBe(1);
  } finally { scope.dispose(); material.dispose(); geometry.dispose(); }
});

test('restored poses and pure height moves do not recheck unchanged XZ bounds', () => {
  const scope = new Scope('pose-writes'), root = new Group(), material = new MeshBasicMaterial(), geometry = new BoxGeometry(2, 2, 2);
  const mesh = new Mesh(geometry, material); root.add(mesh);
  const guard = cellClip(root, 250, scope); guard.sweep(); guard.update();
  try {
    const before = guard.state().checked;
    mesh.position.x = 251; mesh.position.x = 0; guard.update();
    expect(guard.state().checked).toBe(before); expect(mesh.material).toBe(material);
    mesh.position.y = 1000; expect(guard.changed()).toBe(false); guard.update();
    expect(guard.state().checked).toBe(before);
    root.rotation.x = Math.PI / 2; guard.update();
    expect(mesh.material).not.toBe(material);
    mesh.position.y = 0; guard.update(); expect(mesh.material).toBe(material);
    root.rotation.x = 0; guard.update(); root.visible = false;
    mesh.position.x = 251; root.visible = true; guard.update(); expect(mesh.material).not.toBe(material);
    mesh.position.x = 0; guard.update(); expect(mesh.material).toBe(material);
  } finally { scope.dispose(); material.dispose(); geometry.dispose(); }
});

test('dirty pose delivery uses the admission draw index without walking its bone tree', () => {
  const scope = new Scope('pose-index'), root = new Group(), material = new MeshBasicMaterial(), geometry = new BoxGeometry(2, 2, 2);
  const group = new Group(), mesh = new Mesh(geometry, material); group.add(mesh); root.add(group);
  let parent: Object3D = group;
  for (let i = 0; i < 40; i++) { const bone = new Bone(); parent.add(bone); parent = bone; }
  const guard = cellClip(root, 250, scope); guard.sweep(); guard.update();
  const walk = vi.spyOn(group, 'traverse');
  try {
    group.position.x = 251; guard.update(); expect(walk).not.toHaveBeenCalled();
    expect(mesh.material).not.toBe(material);
    group.position.x = 0; guard.update(); expect(mesh.material).toBe(material);
    group.position.x = 1; group.position.x = 0; mesh.position.x = 251; guard.update();
    expect(mesh.material).not.toBe(material); expect(walk).not.toHaveBeenCalled();
  } finally { walk.mockRestore(); scope.dispose(); material.dispose(); geometry.dispose(); }
});

test('removing an admitted subtree releases its listeners and clipped material immediately', () => {
  const scope = new Scope('removed'), root = new Group(), geometry = new BoxGeometry(2, 2, 2), material = new MeshBasicMaterial();
  const group = new Group(), mesh = new Mesh(geometry, material); mesh.position.x = 250; group.add(mesh);
  const guard = cellClip(root, 250, scope); guard.sweep();
  try {
    root.add(group); expect(guard.state().materials).toBe(1);
    const listeners = scope.census.listeners;
    root.remove(group);
    expect(mesh.material).toBe(material); expect(guard.state().materials).toBe(0);
    expect(scope.census.listeners).toBeLessThan(listeners);
    const before = guard.state().checked; mesh.position.x = 1000; guard.update();
    expect(guard.state().checked).toBe(before);
  } finally { scope.dispose(); material.dispose(); geometry.dispose(); }
});

test('a crossing shadow caster is refused as a whole, with no extra shadow or colour programs', () => {
  const scope = new Scope('caster'), root = new Group(), geometry = new BoxGeometry(2, 2, 2), material = new MeshBasicMaterial();
  const mesh = new Mesh(geometry, material); mesh.castShadow = true; mesh.position.x = 251; root.add(mesh);
  const guard = cellClip(root, 250, scope); guard.sweep();
  try {
    expect(mesh.visible).toBe(false); expect(mesh.material).toBe(material);
    expect(guard.state()).toMatchObject({ refused: 1, materials: 0 });
    mesh.visible = true; guard.update(); expect(mesh.visible).toBe(false);
    mesh.position.x = 0; guard.update(); expect(mesh.visible).toBe(true);
  } finally { scope.dispose(); material.dispose(); geometry.dispose(); }
});

test('containment preserves tall structures within their XZ footprint', () => {
  const scope = new Scope('height'), root = new Group(), geometry = new BoxGeometry(1, 1, 1), material = new MeshBasicMaterial();
  const high = new Mesh(geometry, material), low = new Mesh(geometry, material); high.position.y = 251; low.position.y = -251; root.add(high, low);
  const guard = cellClip(root, 250, scope); guard.sweep();
  try { expect(guard.state().meshes).toBe(0); expect(high.material).toBe(material); expect(low.material).toBe(material); }
  finally { scope.dispose(); material.dispose(); geometry.dispose(); }
});

test('a material swap cannot drop containment, and returning inside releases its variant', () => {
  const scope = new Scope('swap'), root = new Group(), geometry = new BoxGeometry(2, 2, 2), first = new MeshBasicMaterial(), second = new MeshBasicMaterial();
  const mesh = new Mesh(geometry, first); mesh.position.x = 250; root.add(mesh);
  const guard = cellClip(root, 250, scope); guard.sweep();
  try {
    guard.update(); mesh.material = second; guard.update();
    expect(mesh.material).not.toBe(second); expect(guard.state().materials).toBe(1);
    mesh.position.x = 0; guard.update();
    expect(mesh.material).toBe(second); expect(guard.state().materials).toBe(0);
  } finally { scope.dispose(); first.dispose(); second.dispose(); geometry.dispose(); }
});

test('a bone pose can cross the edge without changing its mesh transform or geometry', () => {
  const scope = new Scope('skin'), root = new Group(), geometry = new BoxGeometry(2, 2, 2), material = new MeshBasicMaterial();
  const count = geometry.getAttribute('position').count, weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  const mesh = new SkinnedMesh(geometry, material), bone = new Bone(); mesh.add(bone); root.add(mesh);
  mesh.bind(new Skeleton([bone]));
  root.position.set(555, 0, 555);
  const guard = cellClip(root, 250, scope); guard.sweep();
  try {
    // T10: the rig is hooked once, at its skin: its bones carry no pose or matrix setters
    expect(Object.hasOwn(bone.matrix, 'set')).toBe(false); expect(Object.getOwnPropertyDescriptor(bone, 'matrixAutoUpdate')).toMatchObject({ writable: true });
    expect(mesh.material).toBe(material);
    guard.update(); const before = guard.state().checked;
    guard.update(); expect(guard.state().checked).toBe(before);
    bone.position.x = 250; root.updateMatrixWorld(true); mesh.skeleton.update(); guard.update();
    expect(guard.state().checked).toBe(before);
    const renderer = { renderBufferDirect: vi.fn<Renderer['renderBufferDirect']>(), shadowMap: { render: vi.fn<Renderer['shadowMap']['render']>() } }; installShadowMaterialOwnership(renderer, new AssetService(), scope);
    renderer.renderBufferDirect(new PerspectiveCamera(), new Scene(), geometry, material, mesh, { start: 0, count: Infinity });
    expect(mesh.material).not.toBe(material); expect(guard.state().meshes).toBe(1);
  } finally { scope.dispose(); mesh.skeleton.dispose(); geometry.dispose(); material.dispose(); }
});

test('a skin on bones outside the cell (a far herd page) is admitted by its uploaded pose, never thrown on or re-posed', () => {
  const scope = new Scope('borrowed-skin'), root = new Group(), geometry = new BoxGeometry(2, 2, 2), material = new MeshBasicMaterial();
  const count = geometry.getAttribute('position').count, weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  const outside = new Bone(), mesh = new SkinnedMesh(geometry, material);
  mesh.bind(new Skeleton([outside]), new Matrix4());
  const guard = cellClip(root, 250, scope); guard.sweep();
  try {
    // the herd writes its members' pose into the page's bone matrices itself (identity: the copy at the cell's centre)
    mesh.skeleton.boneMatrices?.set(new Matrix4().elements);
    expect(() => { root.add(mesh); }).not.toThrow();
    expect(mesh.visible).toBe(true);
    const uploaded = [...mesh.skeleton.boneMatrices ?? []];
    let draws = 0;
    const renderer = { renderBufferDirect: vi.fn<Renderer['renderBufferDirect']>(() => { draws++; }), shadowMap: { render: vi.fn<Renderer['shadowMap']['render']>() } }; installShadowMaterialOwnership(renderer, new AssetService(), scope);
    renderer.renderBufferDirect(new PerspectiveCamera(), new Scene(), geometry, material, mesh, { start: 0, count: Infinity });
    expect(draws).toBe(1); expect(mesh.material).toBe(material);
    expect([...mesh.skeleton.boneMatrices ?? []]).toEqual(uploaded); // not re-posed from the placeholder bone
    // a member moved across the edge: the next submission is clipped from the uploaded pose
    mesh.skeleton.boneMatrices?.set(new Matrix4().makeTranslation(251, 0, 0).elements);
    if (mesh.skeleton.boneTexture !== null) mesh.skeleton.boneTexture.needsUpdate = true;
    renderer.renderBufferDirect(new PerspectiveCamera(), new Scene(), geometry, material, mesh, { start: 0, count: Infinity });
    expect(mesh.material).not.toBe(material);
  } finally { scope.dispose(); mesh.skeleton.dispose(); geometry.dispose(); material.dispose(); }
});

test('replacing a position attribute with version zero invalidates its old bounds', () => {
  const scope = new Scope('attribute'), root = new Group(), geometry = new BoxGeometry(2, 2, 2), material = new MeshBasicMaterial();
  const mesh = new Mesh(geometry, material); root.add(mesh);
  const guard = cellClip(root, 250, scope); guard.sweep(); guard.update();
  try {
    const position = geometry.getAttribute('position').clone();
    for (let i = 0; i < position.count; i++) position.setX(i, position.getX(i) + 250);
    geometry.setAttribute('position', position); guard.update();
    expect(mesh.material).not.toBe(material);
  } finally { scope.dispose(); geometry.dispose(); material.dispose(); }
});

test('the GPU draw audit excludes zero-instance and zero-range submissions', () => {
  const root = new Group(); root.name = 'grid-cell:empty';
  const geometry = new BoxGeometry(1, 1, 1), material = new MeshBasicMaterial(), mesh = new InstancedMesh(geometry, material, 1);
  root.add(mesh);
  try {
    mesh.count = 0; expect(inspectGridDraw(mesh, material)).toBeNull();
    mesh.count = 1; geometry.setDrawRange(0, 0); expect(inspectGridDraw(mesh, material)).toBeNull();
  } finally { geometry.dispose(); material.dispose(); }
});


test('a static frame does not even read an admitted draw geometry', () => {
  const scope = new Scope('static-events'), root = new Group(), geometry = new BoxGeometry(1, 1, 1), material = new MeshBasicMaterial();
  const mesh = new Mesh(geometry, material); root.add(mesh);
  const guard = cellClip(root, 250, scope); guard.sweep();
  expect(Reflect.get(mesh, 'onBeforeRender')).toBe(Reflect.get(Object3D.prototype, 'onBeforeRender'));
  const read = vi.spyOn(mesh, 'geometry', 'get');
  try {
    guard.update(); guard.update(); expect(read).not.toHaveBeenCalled();
    mesh.position.x = 250; guard.update(); expect(read).toHaveBeenCalled();
    expect(mesh.material).not.toBe(material);
  } finally { read.mockRestore(); scope.dispose(); geometry.dispose(); material.dispose(); }
});

test('an instance upload and an explicit matrix move invalidate only their draw', () => {
  const scope = new Scope('explicit-events'), root = new Group(), geometry = new BoxGeometry(1, 1, 1), material = new MeshBasicMaterial();
  const mesh = new InstancedMesh(geometry, material, 1); root.add(mesh);
  const guard = cellClip(root, 250, scope); guard.sweep();
  try {
    mesh.setMatrixAt(0, new Matrix4().makeTranslation(251, 0, 0)); mesh.instanceMatrix.needsUpdate = true;
    guard.update(); expect(mesh.material).not.toBe(material);
    mesh.setMatrixAt(0, new Matrix4()); mesh.instanceMatrix.needsUpdate = true; guard.update(); expect(mesh.material).toBe(material);
    mesh.matrixAutoUpdate = false; mesh.matrix.makeTranslation(251, 0, 0); guard.update(); expect(mesh.material).not.toBe(material);
    mesh.matrix.identity(); guard.update(); expect(mesh.material).toBe(material);
    mesh.matrix.elements[12] = 251; mesh.matrixWorldNeedsUpdate = true; guard.update(); expect(mesh.material).not.toBe(material);
  } finally { scope.dispose(); geometry.dispose(); material.dispose(); }
});


test('the final draw gate catches callback-time instance changes and keeps bounded depth draws', () => {
  const scope = new Scope('late-upload'), root = new Group(), geometry = new BoxGeometry(1, 1, 1), material = new MeshBasicMaterial(), depth = new MeshBasicMaterial();
  const mesh = new InstancedMesh(geometry, material, 1); mesh.onBeforeRender = () => undefined; root.add(mesh);
  const guard = cellClip(root, 250, scope); guard.sweep();
  let draws = 0;
  const renderer = { renderBufferDirect: vi.fn<Renderer['renderBufferDirect']>(() => { draws++; }), shadowMap: { render: vi.fn<Renderer['shadowMap']['render']>() } };
  installShadowMaterialOwnership(renderer, new AssetService(), scope);
  const camera = new PerspectiveCamera(), scene = new Scene();
  try {
    renderer.renderBufferDirect(camera, scene, geometry, depth, mesh, { start: 0, count: Infinity }); expect(draws).toBe(1);
    mesh.setMatrixAt(0, new Matrix4().makeTranslation(251, 0, 0)); mesh.instanceMatrix.needsUpdate = true;
    renderer.renderBufferDirect(camera, scene, geometry, material, mesh, { start: 0, count: Infinity }); expect(draws).toBe(1);
    renderer.renderBufferDirect(camera, scene, geometry, mesh.material, mesh, { start: 0, count: Infinity }); expect(draws).toBe(2);
    const oldClip = mesh.material; mesh.setMatrixAt(0, new Matrix4()); mesh.instanceMatrix.needsUpdate = true;
    renderer.renderBufferDirect(camera, scene, geometry, oldClip, mesh, { start: 0, count: Infinity }); expect(draws).toBe(2);
    renderer.renderBufferDirect(camera, scene, geometry, material, mesh, { start: 0, count: Infinity }); expect(draws).toBe(3);
  } finally { scope.dispose(); geometry.dispose(); material.dispose(); depth.dispose(); }
});

test('a clip variant made after admission draws once the page has linked it', async () => {
  const scope = new Scope('late-variant'), root = new Group(), geometry = new BoxGeometry(2, 2, 2), material = new MeshBasicMaterial();
  let release: () => void = () => undefined;
  const prepared: Object3D[] = [];
  const prepare = (node: Object3D): Promise<void> => { prepared.push(node); return new Promise<void>((resolve) => { release = resolve; }); };
  const guard = cellClip(root, 250, scope, { prepare }); guard.sweep();
  let draws = 0;
  const renderer = { renderBufferDirect: vi.fn<Renderer['renderBufferDirect']>(() => { draws++; }), shadowMap: { render: vi.fn<Renderer['shadowMap']['render']>() } };
  installShadowMaterialOwnership(renderer, new AssetService(), scope);
  const camera = new PerspectiveCamera(), scene = new Scene();
  try {
    const mesh = new Mesh(geometry, material); mesh.position.x = 250; root.add(mesh);
    expect(mesh.material).not.toBe(material); expect(prepared).toEqual([mesh]);
    renderer.renderBufferDirect(camera, scene, geometry, mesh.material, mesh, { start: 0, count: Infinity }); expect(draws).toBe(0);
    // a second piece on the same variant waits on the same link, with no second preparation
    const twin = new Mesh(geometry, material); twin.position.x = -250; root.add(twin);
    expect(twin.material).toBe(mesh.material); expect(prepared).toHaveLength(1);
    release(); await Promise.resolve(); await Promise.resolve();
    renderer.renderBufferDirect(camera, scene, geometry, mesh.material, mesh, { start: 0, count: Infinity }); expect(draws).toBe(1);
    renderer.renderBufferDirect(camera, scene, geometry, twin.material, twin, { start: 0, count: Infinity }); expect(draws).toBe(2);
  } finally { scope.dispose(); geometry.dispose(); material.dispose(); }
});

test('event-only validation wakes refused draws and keeps the last pose guarded', () => {
  const scope = new Scope('event-only'), root = new Group(), geometry = new BoxGeometry(1, 1, 1), material = new MeshBasicMaterial();
  const mesh = new Mesh(geometry, material); mesh.castShadow = true; mesh.position.x = 251; root.add(mesh);
  const guard = cellClip(root, 250, scope); guard.sweep(); expect(mesh.visible).toBe(false);
  const submit = vi.fn<Renderer['renderBufferDirect']>();
  const renderer = { renderBufferDirect: submit, shadowMap: { render: vi.fn<Renderer['shadowMap']['render']>() } };
  installShadowMaterialOwnership(renderer, new AssetService(), scope);
  const draw = (): void => {
    root.updateMatrixWorld(true);
    if (mesh.visible) renderer.renderBufferDirect(new PerspectiveCamera(), new Scene(), geometry, mesh.material, mesh, { start: 0, count: Infinity });
  };
  try {
    mesh.position.x = 0; expect(mesh.visible).toBe(true);
    mesh.position.x = 251; draw(); expect(submit).not.toHaveBeenCalled(); expect(mesh.visible).toBe(false);
    mesh.position.x = 0; draw(); expect(submit).toHaveBeenCalledOnce();
  } finally { scope.dispose(); geometry.dispose(); material.dispose(); }
});

test('a callback cannot submit an old geometry after replacing its admitted draw', () => {
  const scope = new Scope('old-geometry'), root = new Group(), geometry = new BoxGeometry(1, 1, 1), replacement = new BoxGeometry(1, 1, 1), material = new MeshBasicMaterial();
  const mesh = new Mesh(geometry, material); mesh.onBeforeRender = () => undefined; root.add(mesh);
  const guard = cellClip(root, 250, scope); guard.sweep();
  const submit = vi.fn<Renderer['renderBufferDirect']>();
  const renderer = { renderBufferDirect: submit, shadowMap: { render: vi.fn<Renderer['shadowMap']['render']>() } };
  installShadowMaterialOwnership(renderer, new AssetService(), scope);
  try {
    geometry.translate(300, 0, 0); mesh.geometry = replacement; root.updateMatrixWorld(true);
    renderer.renderBufferDirect(new PerspectiveCamera(), new Scene(), geometry, material, mesh, { start: 0, count: Infinity });
    expect(submit).not.toHaveBeenCalled();
    renderer.renderBufferDirect(new PerspectiveCamera(), new Scene(), replacement, material, mesh, { start: 0, count: Infinity });
    expect(submit).toHaveBeenCalledOnce();
  } finally { scope.dispose(); geometry.dispose(); replacement.dispose(); material.dispose(); }
});


test('replacing an admitted geometry attribute map keeps its upload subscription', () => {
  const scope = new Scope('geometry-copy'), root = new Group(), geometry = new BoxGeometry(1, 1, 1), material = new MeshBasicMaterial();
  const replacement = new BoxGeometry(1, 1, 1).translate(251, 0, 0), mesh = new Mesh(geometry, material); root.add(mesh);
  const guard = cellClip(root, 250, scope); guard.sweep();
  try { geometry.copy(replacement); guard.update(); expect(mesh.material).not.toBe(material); }
  finally { scope.dispose(); geometry.dispose(); replacement.dispose(); material.dispose(); }
});


test('hidden ancestors defer changed-draw checks until their subtree is shown again', () => {
  const scope = new Scope('hidden-tree'), root = new Group(), group = new Group(), geometry = new BoxGeometry(1, 1, 1), material = new MeshBasicMaterial(), mesh = new Mesh(geometry, material);
  group.add(mesh); root.add(group); const guard = cellClip(root, 250, scope); guard.sweep(); guard.update();
  try {
    const before = guard.state().checked; group.visible = false;
    mesh.position.x = 251; guard.update(); guard.update(); expect(guard.state().checked).toBe(before);
    group.visible = true; guard.update(); expect(mesh.material).not.toBe(material);
  } finally { scope.dispose(); geometry.dispose(); material.dispose(); }
});


test('batch instance mutations re-admit aggregate bounds before their next draw', () => {
  const scope = new Scope('batch-move'), root = new Group(), geometry = new BoxGeometry(1, 1, 1), material = new MeshBasicMaterial(), mesh = new BatchedMesh(1, 24, 36, material);
  const instance = mesh.addInstance(mesh.addGeometry(geometry)); root.name = 'grid-cell:batch'; root.add(mesh);
  const guard = cellClip(root, 250, scope); guard.sweep();
  try {
    mesh.setMatrixAt(instance, new Matrix4().makeTranslation(251, 0, 0)); guard.update(); expect(mesh.material).not.toBe(material);
    expect(inspectGridDraw(mesh, mesh.material)?.issue).toBeNull();
    mesh.setMatrixAt(instance, new Matrix4()); guard.update(); expect(mesh.material).toBe(material);
  } finally { scope.dispose(); mesh.dispose(); geometry.dispose(); material.dispose(); }
});


test('an off-centre sprite rechecks its camera-facing envelope when its centre changes', () => {
  const scope = new Scope('sprite'), root = new Group(), material = new SpriteMaterial(), sprite = new Sprite(material);
  sprite.position.x = 248; sprite.scale.set(2, 2, 1); root.add(sprite);
  const guard = cellClip(root, 250, scope); guard.sweep();
  try {
    expect(sprite.material).toBe(material);
    sprite.center.set(-1, 0.5); guard.update(); expect(sprite.material).not.toBe(material);
    sprite.center.set(0.5, 0.5); guard.update(); expect(sprite.material).toBe(material);
  } finally { scope.dispose(); material.dispose(); }
});


test('the skin guard uses the uploaded pose when a later callback moves the bones again', () => {
  const scope = new Scope('uploaded-pose'), root = new Group(), geometry = new BoxGeometry(2, 2, 2), material = new MeshBasicMaterial();
  const count = geometry.getAttribute('position').count, weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  const mesh = new SkinnedMesh(geometry, material), bone = new Bone(); mesh.add(bone); root.add(mesh); mesh.bind(new Skeleton([bone]));
  const guard = cellClip(root, 250, scope); guard.sweep();
  const renderer = { renderBufferDirect: vi.fn<Renderer['renderBufferDirect']>(), shadowMap: { render: vi.fn<Renderer['shadowMap']['render']>() } }; installShadowMaterialOwnership(renderer, new AssetService(), scope);
  try {
    bone.position.x = 251; root.updateMatrixWorld(true); mesh.skeleton.update();
    bone.position.x = 0; root.updateMatrixWorld(true);
    renderer.renderBufferDirect(new PerspectiveCamera(), new Scene(), geometry, material, mesh, { start: 0, count: Infinity });
    expect(mesh.material).not.toBe(material);
  } finally { scope.dispose(); mesh.skeleton.dispose(); geometry.dispose(); material.dispose(); }
});


test('Euler and quaternion changes re-admit a rotated draw while preserving native rotation binding', () => {
  const scope = new Scope('rotated'), root = new Group(), geometry = new BoxGeometry(2, 20, 2), material = new MeshBasicMaterial(), mesh = new Mesh(geometry, material);
  mesh.position.x = 249; root.add(mesh); const guard = cellClip(root, 250, scope); guard.sweep();
  try {
    expect(mesh.material).toBe(material);
    mesh.rotation.z = Math.PI / 2; guard.update(); expect(mesh.material).not.toBe(material);
    mesh.quaternion.identity(); guard.update(); expect(mesh.rotation.z).toBeCloseTo(0); expect(mesh.material).toBe(material);
  } finally { scope.dispose(); geometry.dispose(); material.dispose(); }
});


test('affine containment matches transformed corners under nested rotation and negative scale', () => {
  const scope = new Scope('affine'), root = new Group(), group = new Group(), material = new MeshBasicMaterial(), geometry = new BoxGeometry(2, 4, 8);
  const mesh = new Mesh(geometry, material); mesh.castShadow = true;
  root.position.set(555, 7, -555); group.rotation.set(0.3, 0.5, 0.9); group.scale.set(-2, 0.7, 3); root.add(group); group.add(mesh);
  mesh.rotation.set(-0.4, 0.2, -0.1); mesh.scale.set(1.1, -0.9, 0.8);
  const guard = cellClip(root, 250, scope); guard.sweep();
  try {
    for (const x of [-300, -150, 0, 150, 300]) for (const z of [-300, 0, 300]) {
      mesh.position.set(x, 12, z); root.updateWorldMatrix(true, true); geometry.computeBoundingBox();
      const local = geometry.boundingBox; if (local === null) throw new Error('Missing test geometry bounds');
      const expected = local.clone().applyMatrix4(mesh.matrixWorld);
      const outside = expected.min.x < 305 || expected.max.x > 805 || expected.min.z < -805 || expected.max.z > -305;
      guard.update(); expect(guard.state().refused).toBe(outside ? 1 : 0);
    }
  } finally { scope.dispose(); material.dispose(); geometry.dispose(); }
});
