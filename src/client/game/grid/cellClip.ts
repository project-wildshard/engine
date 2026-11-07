/** Grid-only XZ containment. Admit each draw once; recheck its bounds after a pose or geometry change.
 * Only an edge-crossing draw gains a shader patch. Platform road, floor and sky live outside these roots. */
import { BatchedMesh, Bone, Box3, BufferAttribute, InstancedMesh, Line, Color, Material, Matrix4, Mesh, Points, RawShaderMaterial, ShaderMaterial, SkinnedMesh, Sprite, Vector3, Vector4, BufferGeometry, Sphere, type Camera, Object3D } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { PATCH_ORDER, copyShaderPatches, patchShader } from '@wildshard/engine/render/shaderPatches';
import { geometryBoundsSteps } from '@wildshard/engine/world/geometryBounds';
import { onCellField, onCellMethods } from './cellChanges';
import { skinEnvelope, uploadedSkinBounds } from './skinEnvelope';
import { guardObjectDraw, type DrawGuard } from '@wildshard/engine/render/drawGuards';
import { instanceEnvelope } from '@wildshard/engine/render/instancedGeometry';


/** `material.clone()` with its `userData` shallow-copied by reference (G639: three's Material.copy deep-copies userData through
 *  JSON, and a painted ground's userData holds its textures, so every clipped variant serialised them to data URLs: 224 ms
 *  of one desktop Nalati drive frame, for a copy that kept no texture). D189: the clone keeps the source's `alphaTest`
 *  (a material class whose copy drops it still clips as its source). */
function cloneKeepingData(material: Material): Material {
  const data = material.userData;
  material.userData = {};
  try { const copy = material.clone(); copy.userData = { ...data }; copy.alphaTest = material.alphaTest; return copy; } finally { material.userData = data; }
}
export interface CellClipState { readonly meshes: number; readonly materials: number; readonly unclipped: number; readonly checked: number; readonly refused: number }
export interface CellClip {
  /** Admit a pre-existing tree. Later child additions are admitted synchronously, without a frame sweep. */
  readonly sweep: () => number;
  readonly state: () => CellClipState;
  /** Explicit entry/preparation flush. Ordinary frames validate lazily at final submission. */
  readonly update: () => void;
  /** Whether explicit mutation events have queued draw validation. */
  readonly changed: () => boolean;
}
type Draw = Mesh<BufferGeometry, Material | Material[]> | Line<BufferGeometry, Material | Material[]> | Points<BufferGeometry, Material | Material[]> | Sprite;
const isDraw = (node: Object3D): node is Draw => node instanceof Mesh || node instanceof Line || node instanceof Points || node instanceof Sprite;
const isSkin = (node: Object3D): node is SkinnedMesh => node instanceof SkinnedMesh;
const isMaterial = (value: unknown): value is Material => value instanceof Material;
const MAIN = /void\s+main\s*\(\s*(?:void)?\s*\)/;
/** a stage's leading `#version` / `#extension` lines (a graph batch's vertex stage opens with `#extension
 *  GL_ANGLE_multi_draw`): they must precede every other token, so the clip's own declarations go after them (PF1; the
 *  E271 / E272 compile failure, ~200 'program not valid' a minute on the grid) */
const DIRECTIVES = /^(?:[ \t]*\n)*(?:[ \t]*#(?:version|extension)\b[^\n]*\n(?:[ \t]*\n)*)+/u;
function splitDirectives(source: string): readonly [string, string] {
  const head = DIRECTIVES.exec(source)?.[0] ?? '';
  return [head, source.slice(head.length)];
}

/** Extend the old lit-sheet clip to basic, graph, custom, line, point and sprite programs.
 * The final projected vertex includes instancing, skinning and shader displacement. */
function clipProgram(material: Material, cell: { value: Vector4 }, camera: { value: Matrix4 }, scope: Scope): void {
  patchShader(material, 'grid-cell-clip', PATCH_ORDER.view, shader => {
    if (!MAIN.test(shader.vertexShader) || !MAIN.test(shader.fragmentShader)) throw new Error('Cell draw has no clippable shader main');
    shader.uniforms['wsCellClip'] = cell;
    shader.uniforms['wsCellClipToWorld'] = camera;
    const [vertexHead, vertexBody] = splitDirectives(shader.vertexShader), [fragmentHead, fragmentBody] = splitDirectives(shader.fragmentShader);
    const vertex = vertexBody.replace(MAIN, 'void wsCellVertex()');
    shader.vertexShader = `${vertexHead}
#if __VERSION__ >= 300
out highp vec3 wsCellWorld;
#else
varying highp vec3 wsCellWorld;
#endif
uniform highp mat4 wsCellClipToWorld;
${vertex}
void main() {
  wsCellVertex();
  vec4 cellWorld = wsCellClipToWorld * gl_Position;
  wsCellWorld = cellWorld.xyz / cellWorld.w;
}`;
    shader.fragmentShader = `${fragmentHead}
#if __VERSION__ >= 300
in highp vec3 wsCellWorld;
#else
varying highp vec3 wsCellWorld;
#endif
uniform highp vec4 wsCellClip;
${fragmentBody.replace(MAIN, 'void wsCellFragment()')}
void main() {
  if (wsCellWorld.x < wsCellClip.x || wsCellWorld.z < wsCellClip.y || wsCellWorld.x > wsCellClip.z || wsCellWorld.z > wsCellClip.w) discard;
  wsCellFragment();
}`;
  }, { key: prior => `${prior}|grid-cell-clip`, pureKey: true, sceneShapeKey: true, scope });
  material.needsUpdate = true;
}

/** A conservative local box over an instanced draw's copies: each copy's geometry sphere, moved and scaled by its matrix. */
function copySpheres(sphere: Sphere, m: ArrayLike<number>, count: number, target: Box3): Box3 {
  target.makeEmpty();
  if (sphere.radius < 0) return target;
  const cx = sphere.center.x, cy = sphere.center.y, cz = sphere.center.z, r = sphere.radius;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0, o = 0; i < count; i++, o += 16) {
    const a0 = m[o] ?? 0, a1 = m[o + 1] ?? 0, a2 = m[o + 2] ?? 0, a4 = m[o + 4] ?? 0, a5 = m[o + 5] ?? 0, a6 = m[o + 6] ?? 0;
    const a8 = m[o + 8] ?? 0, a9 = m[o + 9] ?? 0, a10 = m[o + 10] ?? 0;
    const k = r * Math.sqrt(Math.max(a0 * a0 + a1 * a1 + a2 * a2, a4 * a4 + a5 * a5 + a6 * a6, a8 * a8 + a9 * a9 + a10 * a10));
    const x = a0 * cx + a4 * cy + a8 * cz + (m[o + 12] ?? 0), y = a1 * cx + a5 * cy + a9 * cz + (m[o + 13] ?? 0), z = a2 * cx + a6 * cy + a10 * cz + (m[o + 14] ?? 0);
    minX = Math.min(minX, x - k); minY = Math.min(minY, y - k); minZ = Math.min(minZ, z - k);
    maxX = Math.max(maxX, x + k); maxY = Math.max(maxY, y + k); maxZ = Math.max(maxZ, z + k);
  }
  target.min.set(minX, minY, minZ); target.max.set(maxX, maxY, maxZ);
  return target;
}

/** Exact affine XZ projection of an AABB. Height contributes through rotated
 * axes but has no clipping plane. Unusual projective object matrices keep the
 * general eight-corner path. */
function projectBounds(local: Box3, world: Matrix4, target: Box3): Box3 {
  const m = world.elements;
  if (m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) return target.copy(local).applyMatrix4(world);
  const a = local.min, b = local.max, x = (a.x + b.x) * 0.5, y = (a.y + b.y) * 0.5, z = (a.z + b.z) * 0.5;
  const ex = (b.x - a.x) * 0.5, ey = (b.y - a.y) * 0.5, ez = (b.z - a.z) * 0.5;
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cz = m[2] * x + m[6] * y + m[10] * z + m[14];
  const rx = Math.abs(m[0]) * ex + Math.abs(m[4]) * ey + Math.abs(m[8]) * ez;
  const rz = Math.abs(m[2]) * ex + Math.abs(m[6]) * ey + Math.abs(m[10]) * ez;
  target.min.set(cx - rx, 0, cz - rz); target.max.set(cx + rx, 0, cz + rz); return target;
}

export interface CellClipOptions {
  /** The page's precompile for one draw (the session's `prepareView`): a clip variant made after its cell's warm-up links its
   *  program here, its piece held from drawing until it settles, instead of linking at its first draw (G639: a Nalati
   *  dressing slab's variant linked in a 150 ms look frame). Absent, a variant draws at once. */
  readonly prepare?: (node: Object3D) => Promise<void>;
}
/** how long a clipped piece waits for its variant's link before it draws anyway */
const LINK_FALLBACK_MS = 3000;

/** a far herd member's reach from its joints (metres): the largest Pine / Nalati animal is well inside it */
const BORROWED_REACH = 6;
const _joint = new Vector3();

/** Clip edge-crossing draws at the exact inclusive cell edge. No road-band or dome exemption. */
export function cellClip(root: Object3D, half: number, scope: Scope, options: CellClipOptions = {}): CellClip {
  const cell = { value: new Vector4(-half, -half, half, half) }, origin = new Vector3(), box = new Box3(), camera = { value: new Matrix4() }, submittedWorld = new Matrix4(), alternate = new Box3();
  root.updateWorldMatrix(true, false); origin.setFromMatrixPosition(root.matrixWorld);
  if (!Number.isFinite(origin.x) || !Number.isFinite(origin.z)) throw new Error('Cell origin is not finite');
  cell.value.set(origin.x - half, origin.z - half, origin.x + half, origin.z + half);
  const variantScopes = new Map<Material, Scope>(), users = new Map<Material, Set<Draw>>(), drawVariants = new WeakMap<Draw, Set<Material>>();
  const watched = new Map<Object3D, () => void>(), patched = new Map<Material, Material>(), clipped = new WeakSet<Draw>(), ownedVariants = new WeakSet<Material>();
  const refused = new Map<Draw, boolean>();
  const dirty = new Map<Object3D, boolean>(), forced = new Set<Object3D>(), dependents = new Map<Object3D, Set<Draw>>();
  const descendants = new Map<Object3D, Set<Draw>>(), samePose = new Map<Object3D, () => boolean>();
  const gates = new Map<Draw, () => void>(), pending = new Set<Draw>();
  interface DirtyRow {node:Object3D|undefined;tree:boolean}
  interface FlushWork {rows:DirtyRow[];changed:DirtyRow[];draws:Set<Draw>;trees:Set<Object3D>;order:Draw[]}
  const flushWork:FlushWork[]=[];
  const skinVersions = new WeakMap<SkinnedMesh, number>();
  const skinBounds = new WeakMap<SkinnedMesh, (() => Box3) | null>();
  // An instanced draw's bounds walk every copy: keep them while its copies, count and geometry are the ones last walked
  // (the construction sweep's walk then serves the activation and first-draw checks).
  const instanceWalks = new WeakMap<object, { readonly geometry: unknown; readonly version: number; readonly count: number }>();
  // G639 frame floor: culled draws whose last check was decided by their declared envelope alone (every copy they may show),
  // so a change of which copies they draw (the culler's per-frame count and matrix uploads) cannot change it
  const enveloped = new WeakSet<Draw>();
  // clip variants whose program the page's precompile is linking (`options.prepare`): their draws wait for it
  const linking = new Set<Material>();
  const linked = (node: Draw): boolean => linking.size === 0 || (Array.isArray(node.material) ? !node.material.some(m => linking.has(m)) : !linking.has(node.material));
  const link = (node: Draw, fresh: readonly Material[]): void => {
    const prepare = options.prepare;
    if (prepare === undefined || fresh.length === 0) return;
    for (const variant of fresh) linking.add(variant);
    let settled = false, timer: ReturnType<typeof scope.timeout> = 0;
    const settle = (): void => { if (settled) return; settled = true; scope.cancelTimer(timer); for (const variant of fresh) linking.delete(variant); };
    timer = scope.timeout(LINK_FALLBACK_MS, settle);
    const run = async (): Promise<void> => {
      try { await prepare(node); } catch (error: unknown) { console.warn('[grid] clip variant link stopped', error); } finally { settle(); }
    };
    void run();
  };
  let meshes = 0, checked = 0, checking = false, submitting = false;
  let flush = (): void => undefined;
  let validate = (_node: Draw, _submitted: boolean, _view?: Camera): void => undefined;
  // Skins drawn on free placeholder bones, in no tree (a far herd's page: the herd writes its members' poses into its bone
  // matrices): no bone changes can be followed, so each submission is checked from its uploaded pose, and the guard never
  // re-poses it (its skeleton's update would write the placeholders' pose over the herd's). A bone in another tree (another
  // cell's) is still refused below.
  const borrowedSkins = new WeakSet<Draw>();
  const borrowsBones = (node: SkinnedMesh): boolean => node.skeleton.bones.some((bone) => bone.parent === null);
  const borrowedBounds = (node: SkinnedMesh, target: Box3): Box3 => {
    target.makeEmpty();
    const m = node.skeleton.boneMatrices;
    if (m !== null) for (let o = 0; o + 15 < m.length; o += 16) target.expandByPoint(_joint.set(m[o + 12] ?? 0, m[o + 13] ?? 0, m[o + 14] ?? 0));
    if (target.isEmpty()) target.setFromCenterAndSize(_joint.set(0, 0, 0), _joint.clone());
    return target.expandByScalar(BORROWED_REACH);
  };
  const boneOwned = (node: Object3D): boolean => { for (let parent = node.parent; parent !== null && parent !== root; parent = parent.parent) if (parent instanceof Bone) return true; return false; };
  const customDraw = (node: Draw): boolean => node.onBeforeRender !== Object3D.prototype.onBeforeRender;
  const wireframe = (material: Material): boolean => Reflect.get(material, 'wireframe') === true;
  const gate = (node: Draw): void => {
    if (gates.has(node)) return;
    const attached = boneOwned(node) || borrowedSkins.has(node);
    const admitCellDraw: DrawGuard = (view, _scene, geometry, material) => {
      if (geometry !== node.geometry) return false;
      // a triangle draw of at most one index puts no pixel anywhere: admitted unchecked, so three binds (uploads) its index
      // ahead of its first real draw (a reserved far-herd page: farHerd.ts uploadEmpty; refused, its ~1.5 MB index went up
      // with its first members, eight pages at once 1.3 s after Pine's activate)
      if (geometry.drawRange.count <= 1 && node instanceof Mesh && !(Array.isArray(node.material) ? node.material.some(m => wireframe(m)) : wireframe(node.material))) return true;
      const moved = dirty.size > 0 || attached;
      submitting = true;
      try { flush(); } finally { submitting = false; }
      if (attached) pending.add(node);
      if (isSkin(node)) {
        const version = node.skeleton.boneTexture?.version ?? -1;
        if (version !== skinVersions.get(node)) { skinVersions.set(node, version); pending.add(node); }
      }
      validate(node, true, moved ? view : undefined);
      if (clipped.has(node)) camera.value.multiplyMatrices(view.matrixWorld, view.projectionMatrixInverse);
      const active = Array.isArray(node.material) ? node.material.includes(material) : node.material === material;
      return !refused.has(node) && linked(node) && (active || (!clipped.has(node) && !ownedVariants.has(material)));
    };
    gates.set(node, guardObjectDraw(node, admitCellDraw, scope));
  };
  const unclip = (node: Draw): void => {
    const sourceOf = (material: Material): Material => {
      for (const [source, variant] of patched) if (variant === material) return source;
      return material;
    };
    Reflect.set(node, 'material', Array.isArray(node.material) ? node.material.map(sourceOf) : sourceOf(node.material));
    for (const variant of drawVariants.get(node) ?? []) {
      const held = users.get(variant); held?.delete(node);
      if (held?.size === 0) {
        variantScopes.get(variant)?.dispose(); variantScopes.delete(variant); users.delete(variant);
        for (const [source, cached] of patched) if (cached === variant) patched.delete(source);
      }
    }
    drawVariants.delete(node);
    if (clipped.delete(node)) meshes--;
  };
  const within = (bounds: Box3): boolean => {
    const rounding = Number.EPSILON * Math.max(half, Math.abs(origin.x), Math.abs(origin.z)) * 32;
    return bounds.min.x >= cell.value.x - rounding && bounds.max.x <= cell.value.z + rounding && bounds.min.z >= cell.value.y - rounding && bounds.max.z <= cell.value.w + rounding;
  };
  const check = (node: Draw, submitted = false, view?: Camera): void => {
    checked++; if (!submitted) node.updateWorldMatrix(true, false);
    const held = drawVariants.get(node);
    if (held !== undefined) {
      const current = node.material;
      if (Array.isArray(current) ? current.some(material => !held.has(material)) : !held.has(current)) unclip(node);
    }
    if (!node.geometry.hasAttribute('position') || node.geometry.getAttribute('position').count === 0) return;
    const declared = node instanceof InstancedMesh ? instanceEnvelope(node) : undefined;
    const copiesBox = declared === undefined || declared.isEmpty() ? undefined : declared;
    enveloped.delete(node);
    if (node instanceof Sprite) {
      const scale = node.getWorldScale(new Vector3());
      const radius = Math.hypot(Math.max(Math.abs(node.center.x), Math.abs(1 - node.center.x)) * scale.x,
        Math.max(Math.abs(node.center.y), Math.abs(1 - node.center.y)) * scale.y);
      box.setFromCenterAndSize(node.getWorldPosition(new Vector3()), new Vector3(radius * 2, radius * 2, radius * 2));
    } else if (isSkin(node) && borrowedSkins.has(node)) {
      // a far herd page: its members' joints (the uploaded bone matrices' translations) padded by a body's reach, never a
      // scan of its batched geometry (sixteen rigs a page, rebuilt as it grows: 199 ms of Pine's desktop entry frames)
      projectBounds(borrowedBounds(node, alternate), node.matrixWorld, box);
    } else if (isSkin(node)) {
      if (!submitted) {
        node.updateMatrixWorld(true);
        const bones = new Set<Object3D>(node.skeleton.bones);
        for (const bone of bones) if (!(bone.parent instanceof Bone) || !bones.has(bone.parent)) bone.updateWorldMatrix(true, true);
        node.skeleton.update();
      }
      let envelope = skinBounds.get(node);
      if (envelope === undefined) { envelope = skinEnvelope(node); skinBounds.set(node, envelope); }
      const local = envelope === null ? uploadedSkinBounds(node, alternate) : envelope();
      if (view === undefined) projectBounds(local, node.matrixWorld, box);
      else {
        submittedWorld.multiplyMatrices(view.matrixWorld, node.modelViewMatrix);
        projectBounds(local, submittedWorld, box);
        box.union(projectBounds(local, node.matrixWorld, alternate));
      }
    } else if (copiesBox !== undefined && (!node.castShadow || within(projectBounds(copiesBox, node.matrixWorld, box)))) {
      // a culled draw's declared envelope over every copy it may show: one decision whichever copies are drawn (none yet
      // at entry), so its clipped program is prepared with the cell. A caster whose envelope crosses keeps its copies' test
      // below (crossing, it is refused); inside, every copy it may draw is inside.
      if (!node.castShadow) projectBounds(copiesBox, node.matrixWorld, box);
      enveloped.add(node);
    } else if (node instanceof InstancedMesh && node.count === 0) {
      return;
    } else if (node instanceof InstancedMesh || node instanceof BatchedMesh) {
      // Most copies lie well inside the cell: their spheres, moved by their matrices, settle it without the exact walk over
      // eight corners of every copy (25 ms of Pine's entry frames at 4x CPU, where its copies had just moved).
      const shape: unknown = node.geometry;
      if (shape instanceof BufferGeometry && shape.boundingSphere === null) shape.computeBoundingSphere();
      const sphere: unknown = shape instanceof BufferGeometry ? shape.boundingSphere : null;
      if (!(node instanceof InstancedMesh) || !(sphere instanceof Sphere)
        || !within(projectBounds(copySpheres(sphere, node.instanceMatrix.array, node.count, alternate), node.matrixWorld, box))) {
        const walked = node instanceof InstancedMesh ? instanceWalks.get(node) : undefined;
        if (node.boundingBox === null || !(node instanceof InstancedMesh) || walked === undefined || walked.geometry !== node.geometry
          || walked.version !== node.instanceMatrix.version || walked.count !== node.count) {
          node.computeBoundingBox();
          if (node instanceof InstancedMesh) instanceWalks.set(node, { geometry: node.geometry, version: node.instanceMatrix.version, count: node.count });
        }
        if (node.boundingBox === null) throw new Error('Cell draw has no instance bounds');
        projectBounds(node.boundingBox, node.matrixWorld, box);
      }
    } else {
      if (node.geometry.boundingBox === null) for (const _step of geometryBoundsSteps(node.geometry, 'box')) { /* exact admission scan */ }
      if (node.geometry.boundingBox === null) throw new Error('Cell draw has no geometry bounds');
      projectBounds(node.geometry.boundingBox, node.matrixWorld, box);
    }
    if (!Number.isFinite(box.min.x) || !Number.isFinite(box.min.y) || !Number.isFinite(box.min.z)
      || !Number.isFinite(box.max.x) || !Number.isFinite(box.max.y) || !Number.isFinite(box.max.z)) throw new Error('Cell draw has nonfinite bounds');
    if (within(box)) {
      const visible = refused.get(node);
      if (visible !== undefined) { node.visible = visible; refused.delete(node); }
      if (clipped.has(node)) unclip(node);
      return;
    }
    // Refuse a crossing shadow caster as a whole: clipping only its colour
    // program would still upload its out-of-cell triangles into shadow maps.
    if (node.castShadow) { if (!refused.has(node)) refused.set(node, node.visible); node.visible = false; return; }
    const source: unknown = node.material;
    const candidates: readonly unknown[] = Array.isArray(source) ? source : [source];
    const list = candidates.map(value => { if (!isMaterial(value)) throw new Error('Cell draw has no material'); return value; });
    // A raw program owns its coordinate/GLSL contract. Refuse its crossing draw
    // rather than assume the standard camera uniforms or add a second program.
    if (list.some(material => material instanceof RawShaderMaterial)) { if (!refused.has(node)) refused.set(node, node.visible); node.visible = false; return; }
    const visible = refused.get(node);
    if (visible !== undefined) { node.visible = visible; refused.delete(node); }
    const fresh: Material[] = [];
    const variants = list.map(material => {
      if ([...patched.values()].includes(material)) return material;
      let variant = patched.get(material);
      if (variant === undefined) {
        variant = cloneKeepingData(material); ownedVariants.add(variant); copyShaderPatches(material, variant); fresh.push(variant);
        // G639: Material.copy carries no defines (only ShaderMaterial's does): the cascades' USE_CSM / CSM_CASCADES / CSM_FADE
        // set on the source (Sky.setupMaterial) went missing, so a clipped piece drew unshadowed on a program of its own
        // that linked on its first sight (161 ms of a Nalati look frame at phone 4x)
        if (material.defines !== undefined) variant.defines = { ...variant.defines, ...material.defines };
        // Shared content keeps its original material. Animated colours and shader
        // uniform cells remain borrowed; the clip uniform belongs to this variant.
        for (const [key, value] of Object.entries(material)) if (value instanceof Color) Reflect.set(variant, key, value);
        if (material instanceof ShaderMaterial && variant instanceof ShaderMaterial) variant.uniforms = { ...material.uniforms };
        const variantScope = scope.child('cell.clip-material');
        variantScopes.set(variant, variantScope); users.set(variant, new Set());
        patched.set(material, variant); variantScope.own(variant); clipProgram(variant, cell, camera, variantScope);
        const borrowed = variant;
        variantScope.onDispose(onCellField(material, 'opacity', () => { borrowed.opacity = material.opacity; }));
        variantScope.onDispose(onCellField(material, 'visible', () => { borrowed.visible = material.visible; }));
      }
      return variant;
    });
    for (const variant of variants) users.get(variant)?.add(node);
    drawVariants.set(node, new Set(variants));
    if (Array.isArray(node.material)) node.material = variants;
    else {
      const variant = variants[0];
      if (variant === undefined) throw new Error('Cell draw has no material');
      Reflect.set(node, 'material', variant);
    }
    if (!clipped.has(node)) { clipped.add(node); meshes++; }
    gate(node);
    link(node, fresh);
  };
  const shown = (node: Object3D): boolean => {
    for (let parent: Object3D | null = node; parent !== null; parent = parent.parent) if (!parent.visible && !(isDraw(parent) && refused.has(parent))) return false;
    return true;
  };
  const mark = (node: Object3D, tree = false, force = !tree): void => {
    if (checking || !watched.has(node)) return;
    if (force) forced.add(node);
    const repeated = dirty.get(node) === true || (!tree && dirty.has(node));
    if (repeated && refused.size === 0) return;
    if (!shown(node)) { samePose.get(node)?.(); forced.delete(node); return; } // Reveal forces fresh bounds for the whole subtree.
    dirty.set(node, tree || dirty.get(node) === true);
    if (tree) for (const draw of descendants.get(node) ?? []) gate(draw);
    else if (isDraw(node)) gate(node);
    for (const skin of dependents.get(node) ?? []) gate(skin);
    if (refused.size > 0) {
      // Invisible refusals never reach the renderer. Reconsider them only on an
      // explicit change, while keeping the queued final-pose check for siblings.
      const reconsider = (draw: Draw): void => {
        if (!refused.has(draw)) return;
        forced.add(node); pending.add(draw); validate(draw, false);
      };
      if (tree) for (const draw of descendants.get(node) ?? []) reconsider(draw);
      else if (isDraw(node)) reconsider(node);
      for (const skin of dependents.get(node) ?? []) reconsider(skin);
    }
  };
  validate = (draw: Draw, submitted: boolean, view?: Camera): void => {
    if (!pending.delete(draw)) return;
    checking = true;
    try {
      check(draw, submitted, view);
      if (dirty.size === 0 && !clipped.has(draw) && !refused.has(draw) && !customDraw(draw) && !(isSkin(draw)) && !boneOwned(draw)) { gates.get(draw)?.(); gates.delete(draw); }
    } finally { checking = false; }
  };
  flush = (): void => {
    if (dirty.size === 0 || checking) return;
    const work:FlushWork=flushWork.pop()??{rows:[],changed:[],draws:new Set<Draw>(),trees:new Set<Object3D>(),order:[]};
    const {rows,changed,draws,trees,order}=work;let count=0;
    try{
      // Snapshot every dirty entry before any samePose callback can reenter.
      dirty.forEach((tree,node)=>{
        let row=rows[count++];if(row===undefined){row={node,tree};rows.push(row);}else{row.node=node;row.tree=tree;}
      });
      for(let i=0;i<count;i++){
        const row=rows[i],node=row?.node;if(row===undefined||node===undefined)throw new Error('Missing dirty draw');
        const tree=row.tree,unchanged=samePose.get(node)?.()??false;
        if(!forced.has(node)&&tree&&unchanged){
          for(const draw of descendants.get(node)??[]){
            if(!pending.has(draw)&&!clipped.has(draw)&&!refused.has(draw)&&!customDraw(draw)&&!isSkin(draw)&&!boneOwned(draw)){gates.get(draw)?.();gates.delete(draw);}
          }
        }
        if(forced.has(node)||!tree||!unchanged)changed.push(row);
      }
      dirty.clear();forced.clear();
      const collect=(node:Object3D):void=>{
        if(isDraw(node)&&watched.has(node))draws.add(node);
        for(const skin of dependents.get(node)??[])draws.add(skin);
      };
      for(let i=0;i<changed.length;i++){const row=changed[i];if(row?.tree===true&&row.node!==undefined)trees.add(row.node);}
      for(let i=0;i<changed.length;i++){
        const row=changed[i],node=row?.node;if(row===undefined||node===undefined)throw new Error('Missing changed draw');
        let covered=false;for(let parent=node.parent;parent!==null&&!covered;parent=parent.parent)covered=trees.has(parent);
        if(covered)continue;
        if(row.tree)for(const draw of descendants.get(node)??[])collect(draw);
        collect(node);
      }
      draws.forEach(draw=>{order.push(draw);});
      for(let i=0;i<order.length;i++){
        const draw=order[i];if(draw===undefined)throw new Error('Missing clip draw');
        if(!shown(draw))continue;pending.add(draw);
        // Preserve lazy final-pose checks for submitted or offscreen skins.
        if(submitting||(isSkin(draw)&&!refused.has(draw)))gate(draw);else validate(draw,false);
      }
    }finally{
      for(let i=0;i<count;i++){const row=rows[i];if(row!==undefined)row.node=undefined;}
      changed.length=0;order.length=0;draws.clear();trees.clear();
      if(!scope.disposed&&!scope.disposing)flushWork.push(work);
    }
  };
  const unwatchNode = (node: Object3D): void => {
    watched.get(node)?.(); watched.delete(node); dirty.delete(node); forced.delete(node); samePose.delete(node);
    if (isDraw(node)) {
      gates.get(node)?.(); gates.delete(node); pending.delete(node);
      const visible = refused.get(node); if (visible !== undefined) node.visible = visible; refused.delete(node);
      unclip(node);
    }
  };
  const unwatch = (node: Object3D): void => { unwatchNode(node); for (const child of node.children) unwatch(child); };
  const watch = (node: Object3D): void => {
    if (watched.has(node)) return;
    const undo: (() => void)[] = [];
    watched.set(node, () => { for (const restore of undo.reverse()) restore(); });
    const moved = (): void => { node.matrixWorldNeedsUpdate = true; mark(node, true); };
    if (node instanceof Bone) {
      // A rig is hooked once, at its skin: the skin's skeleton.update hook compares the uploaded bone matrices and every draw
      // under a bone is gated at its draw, so a bone keeps only its child listeners (T10: Pine's herd spawns hooked ~30
      // setters on every bone of every rig, ~100 ms across a Simulator drive, and its animated bones fired them every frame)
      undo.push(scope.listenEmitter(node, 'childadded', (event: { child: Object3D }): void => { watch(event.child); }));
      undo.push(scope.listenEmitter(node, 'childremoved', (event: { child: Object3D }): void => { unwatch(event.child); }));
      for (const child of node.children) watch(child);
      return;
    }
    {
      const p = node.position, size = node.scale;
      let px = p.x, py = p.y, pz = p.z, sx = size.x, sy = size.y, sz = size.z, auto = node.matrixAutoUpdate;
      const q = node.quaternion;
      let x = q.x, y = q.y, z = q.z, w = q.w;
      let checkedX = x, checkedY = y, checkedZ = z, checkedW = w;
      const matrix = node.matrix.elements.slice();
      samePose.set(node, () => {
        const parent = node.parent?.matrixWorld.elements;
        const heightAffectsXZ = parent !== undefined && (parent[4] !== 0 || parent[6] !== 0);
        const unchanged = px === p.x && (!heightAffectsXZ || py === p.y) && pz === p.z && sx === size.x && sy === size.y && sz === size.z
          && checkedX === q.x && checkedY === q.y && checkedZ === q.z && checkedW === q.w && auto === node.matrixAutoUpdate
          && (auto || matrix.every((value, index) => value === node.matrix.elements[index]));
        px = p.x; py = p.y; pz = p.z; sx = size.x; sy = size.y; sz = size.z;
        checkedX = q.x; checkedY = q.y; checkedZ = q.z; checkedW = q.w; auto = node.matrixAutoUpdate;
        if (!auto) for (let i = 0; i < matrix.length; i++) matrix[i] = node.matrix.elements[i] ?? Number.NaN;
        return unchanged;
      });
      for (const key of ['x', 'z']) undo.push(onCellField(p, key, moved));
      undo.push(onCellField(p, 'y', () => {
        node.matrixWorldNeedsUpdate = true;
        const parent = node.parent?.matrixWorld.elements;
        if (parent !== undefined && (parent[4] !== 0 || parent[6] !== 0)) mark(node, true);
        else py = p.y;
      }));
      for (const key of ['x', 'y', 'z']) undo.push(onCellField(size, key, moved));
      const rotated = (): void => {
        if (x === q.x && y === q.y && z === q.z && w === q.w) return;
        x = q.x; y = q.y; z = q.z; w = q.w; moved();
      };
      undo.push(onCellMethods(q, ['_onChangeCallback'], rotated));
      undo.push(onCellMethods(node.rotation, ['_onChangeCallback'], rotated));
    }
    // Matrix-auto objects already emit via position/scale/quaternion, and their matrix is recomposed from those at every
    // update, so a write through its methods never stands: explicit matrix writers are hooked only while the node is manual
    // (T10: ~25 method wrappers on every node of every Pine herd rig were ~40 ms of its cold spawn at phone 4x). Renderer
    // compose is excluded.
    const matrixMethods = ['set', 'identity', 'copy', 'copyPosition', 'setPosition', 'multiply', 'premultiply', 'multiplyMatrices', 'multiplyScalar', 'transpose', 'invert', 'scale', 'makeTranslation', 'makeRotationX', 'makeRotationY', 'makeRotationZ', 'makeRotationAxis', 'makeScale', 'makeShear', 'fromArray'];
    let manualStop: () => void = () => undefined;
    const manual = (): void => {
      manualStop();
      const stopFlag = node.matrixAutoUpdate ? () => undefined : onCellField(node, 'matrixWorldNeedsUpdate', () => { if (node.matrixWorldNeedsUpdate) mark(node, true); });
      const stopWrites = node.matrixAutoUpdate ? () => undefined : onCellMethods(node.matrix, matrixMethods, moved);
      const stopCompose = node.matrixAutoUpdate ? () => undefined : onCellMethods(node.matrix, ['compose'], moved);
      manualStop = () => { stopFlag(); stopWrites(); stopCompose(); };
    };
    manual(); undo.push(() => { manualStop(); });
    undo.push(onCellField(node, 'matrixAutoUpdate', () => { manual(); moved(); }));
    undo.push(onCellField(node, 'visible', () => { if (!checking && node.visible) mark(node, true, true); }));
    undo.push(scope.listenEmitter(node, 'childadded', (event: { child: Object3D }): void => { watch(event.child); }));
    undo.push(scope.listenEmitter(node, 'childremoved', (event: { child: Object3D }): void => { unwatch(event.child); }));
    if (isDraw(node)) {
      for (let parent: Object3D | null = node; parent !== null; parent = parent.parent) {
        const ancestor = parent;
        let list = descendants.get(ancestor); if (list === undefined) { list = new Set(); descendants.set(ancestor, list); }
        const held = list; held.add(node);
        undo.push(() => { held.delete(node); if (held.size === 0) descendants.delete(ancestor); });
        if (parent === root) break;
      }
      if (node instanceof Sprite) for (const key of ['x', 'y']) undo.push(onCellField(node.center, key, () => { mark(node); }));
      if (node instanceof BatchedMesh) undo.push(onCellMethods(node, ['setMatrixAt', 'setGeometryAt', 'setGeometryIdAt', 'addInstance', 'deleteInstance', 'addGeometry', 'deleteGeometry', 'setVisibleAt', 'optimize'], () => { mark(node); }));
      let contentUndo: (() => void)[] = [];
      const bind = (): void => {
        for (const stop of contentUndo) stop(); contentUndo = [];
        const geometry = node.geometry;
        if (isSkin(node)) skinBounds.delete(node);
        contentUndo.push(onCellField(geometry, 'attributes', () => { if (!checking) { bind(); mark(node); } }));
        for (const name of isSkin(node) ? ['position', 'skinIndex', 'skinWeight'] : ['position']) {
          let attributeStop: (() => void) | undefined;
          const attribute = (invalidate: boolean): void => {
            attributeStop?.();
            const value = geometry.hasAttribute(name) ? geometry.getAttribute(name) : undefined;
            const version = value instanceof BufferAttribute ? value : value?.data;
            attributeStop = version === undefined ? undefined : onCellField(version, 'version', () => { geometry.boundingBox = null; if (isSkin(node)) skinBounds.delete(node); mark(node); });
            if (invalidate) { geometry.boundingBox = null; if (isSkin(node)) skinBounds.delete(node); mark(node); }
          };
          contentUndo.push(onCellField(geometry.attributes, name, () => { attribute(true); }), () => { attributeStop?.(); });
          attribute(false);
        }
        if (isSkin(node)) {
          const changedMorph = (): void => { bind(); mark(node); };
          contentUndo.push(onCellField(geometry, 'morphAttributes', changedMorph));
          contentUndo.push(onCellField(geometry.morphAttributes, 'position', changedMorph));
          const targets = geometry.morphAttributes.position;
          if (targets !== undefined) for (let i = 0; i < targets.length; i++) {
            contentUndo.push(onCellField(targets, String(i), changedMorph));
            const target = targets[i], version = target instanceof BufferAttribute ? target : target?.data;
            if (version !== undefined) contentUndo.push(onCellField(version, 'version', () => { skinBounds.delete(node); mark(node); }));
          }
        }
        if (node instanceof InstancedMesh) contentUndo.push(onCellField(node.instanceMatrix, 'version', () => { if (!enveloped.has(node)) mark(node); }));
        const morph = node instanceof Mesh ? node.morphTargetInfluences : undefined;
        if (morph !== undefined) for (let i = 0; i < morph.length; i++) contentUndo.push(onCellField(morph, String(i), () => { mark(node); }));
        if (Array.isArray(node.material)) for (let i = 0; i < node.material.length; i++) contentUndo.push(onCellField(node.material, String(i), () => { mark(node); }));
      };
      undo.push(() => { for (const stop of contentUndo) stop(); });
      undo.push(onCellField(node, 'geometry', () => { if (!checking) { bind(); mark(node); } }));
      undo.push(onCellField(node, 'material', () => {
        if (checking) return;
        checking = true; try { unclip(node); } finally { checking = false; }
        bind(); mark(node);
      }));
      // a count or caster change rebinds nothing (only a replaced instanceMatrix / morphTargetInfluences array does); an
      // enveloped draw's count is a culler's per-frame copy choice
      for (const key of ['castShadow', 'count']) if (Object.hasOwn(node, key)) undo.push(onCellField(node, key, () => { if (!checking && !(key === 'count' && enveloped.has(node))) mark(node); }));
      for (const key of ['instanceMatrix', 'morphTargetInfluences']) if (Object.hasOwn(node, key)) undo.push(onCellField(node, key, () => { if (!checking) { bind(); mark(node); } }));
      // G639 (it threw here: the throw left Pine's whole grid animal system switched off, its herds frozen and undrawn by
      // the far herd, 106 + 100 draws of 20-bone rigs a desktop frame)
      if (isSkin(node) && borrowsBones(node)) borrowedSkins.add(node);
      if (isSkin(node)) {
        let prior = new Float32Array();
        undo.push(onCellMethods(node.skeleton, ['update'], () => {
          skinVersions.set(node, node.skeleton.boneTexture?.version ?? -1);
          const current = node.skeleton.boneMatrices;
          if (current === null) throw new Error('Cell skin has no live bone matrices');
          let changed = prior.length !== current.length;
          for (let i = 0; !changed && i < current.length; i++) changed = current[i] !== prior[i];
          if (!changed) return;
          if (prior.length !== current.length) prior = new Float32Array(current.length);
          prior.set(current); pending.add(node);
        }));
        const invalidate = (): void => { skinBounds.delete(node); pending.add(node); };
        undo.push(onCellMethods(node.bindMatrix, matrixMethods, invalidate));
        for (const inverse of node.skeleton.boneInverses) undo.push(onCellMethods(inverse, matrixMethods, invalidate));
        gate(node);
      }
      if (boneOwned(node)) gate(node);
      if (isSkin(node)) for (const bone of node.skeleton.bones) {
        let parent: Object3D | null = bone;
        for (; parent !== null && parent !== root; parent = parent.parent) {
          const dependency = parent;
          let list = dependents.get(dependency); if (list === undefined) { list = new Set(); dependents.set(dependency, list); }
          const held = list; held.add(node);
          undo.push(() => { held.delete(node); if (held.size === 0) dependents.delete(dependency); });
        }
        if (parent === null && bone.parent === null) continue; // a free placeholder: checked from its uploaded pose (`borrowedSkins`)
        if (parent === null) { node.visible = false; throw new Error('Cell skin borrows bones outside its cell'); }
      }
      bind();
      undo.push(onCellField(node, 'onBeforeRender', () => { mark(node); if (customDraw(node)) gate(node); }));
      if (customDraw(node)) gate(node);
      checking = true; try { check(node); } finally { checking = false; }
    }
    for (const child of node.children) watch(child);
  };
  // G598: a retiring cell's whole tree is unwatched 16 nodes a step (Driftwood's root held one 14 ms step, 64 nodes still
  // 11 ms); `dispose()` runs it whole
  scope.onDisposeSteps(function* releaseClip() {
    const nodes: Object3D[] = []; root.traverse(node => { nodes.push(node); });
    for (let at = 0; at < nodes.length; at += 16) {
      checking = true;
      try { for (const node of nodes.slice(at, at + 16)) unwatchNode(node); } finally { checking = false; }
      yield;
    }
    watched.clear(); dirty.clear(); forced.clear(); samePose.clear(); descendants.clear(); dependents.clear(); gates.clear(); pending.clear();
    patched.clear(); variantScopes.clear(); users.clear(); refused.clear();
  });
  return { update: flush, changed: () => dirty.size > 0, sweep: () => { const prior = meshes; watch(root); flush(); return meshes - prior; }, state: () => ({ meshes, materials: patched.size, unclipped: 0, checked, refused: refused.size }) };
}
