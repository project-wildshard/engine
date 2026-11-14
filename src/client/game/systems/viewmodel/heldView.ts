/**
 * G601 C10: the held view host (format/heldView rows): first-person arms on the shared rig player, dressed by their look
 * kind. `toon` dresses two blade rigs and the swimming hands in toon-family looks that follow the row's day lighting; `graph` dresses one rig in graph looks with their
 * maps, weave and decals, back-face and additive looks, the pendants' client scene on their socket, the swing trail in
 * its own look and the frame rows that write time, buffer size, pixel ratio and projection into the looks. Rows are
 * admitted before any rig, look or texture is borrowed; Model Explorer cards settle the same rigs. Client-only.
 */
import { BackSide, type BufferGeometry, ClampToEdgeWrapping, CompressedTexture, DataTexture, DoubleSide, LinearMipmapLinearFilter, type Material, Mesh, NoColorSpace,
  type Object3D, type PerspectiveCamera, Quaternion, RedFormat, RepeatWrapping, SkinnedMesh, Texture, UnsignedByteType, Vector2, Vector3 } from 'three';
import type { RigBake, RigContract } from '@wildshard/engine/anim/rig';
import { retainCachedResources } from '@wildshard/engine/app/cachedAssets';
import { ownSceneResource } from '@wildshard/engine/app/sceneOwnership';
import { resourceScope } from '@wildshard/engine/app/resources';
import { app } from '@wildshard/engine/app/runtime';
import type { Scope } from '@wildshard/engine/app/scope';
import { fetchImage, phoneUrl } from '@wildshard/engine/boot/bytes';
import { ktx2Texture, readHeldForm } from '@wildshard/engine/core/ktx2';
import { loadTextureRow } from '@wildshard/engine/core/assets';
import { SlashTrail } from '@wildshard/engine/combat/view/slashTrail';
import type { ModelContext } from '@wildshard/engine/models/model';
import type { SwimArms } from '@wildshard/engine/player/Hands';
import type { ToonLookUniforms } from '@wildshard/engine/render/families/toon';
import type { Renderer } from '@wildshard/engine/render/renderer';
import type { SkyRig as Sky } from '@wildshard/engine/world/skyRig';
import type { GraphLiteral } from '@wildshard/format/materialGraph';
import { parseHeldView, type HeldViewRow } from '@wildshard/format/heldView';
import { toonLighting } from '../../looks/toonLighting';
import { loadFirstPartyFolder, runtimeLookMaterials } from '../../shardfile/runtimeFolder';
import type { ShardFolder } from '../../../../shared/game/shardfile/shardFolder';
import { createClientScene } from '../../plugin/scene';
import { worldScenePool } from '../../shardfile/scenePools';
import { BLEND_ADD_KEEP_ALPHA } from '../../plugin/shaderFamily';
import type { ShardSword } from '../../shard/manifest';
import type { ShardContext } from '../../plugin/context';
import { ARM_CLIPS, SWIM_CLIPS, armClipNames } from './armClips';
import { RigArms, skinRigid, swordArmsOf, vmScale, type RigState } from './rigArms';

type Looks = Awaited<ReturnType<typeof runtimeLookMaterials>>;
type Toon = Extract<HeldViewRow, { kind: 'toon' }>;
type Graph = Extract<HeldViewRow, { kind: 'graph' }>;
type Blade = 'wood' | 'iron';
type DressedRig = Pick<RigArms, 'root' | 'nodes' | 'meta' | 'weapon' | 'meshes' | 'update' | 'swim' | 'play' | 'blade'>;
/** the arm clips, and with toon's swimming hands the swim clips too */
const TOON_CLIPS = { ...ARM_CLIPS, ...SWIM_CLIPS };
/** a rig at rest: no walk, no look */
const still = (): RigState => ({ speed: 0, lookVel: new Vector2() });
/** toon hosts by row id, so a manifest's lazy sword and the entered equipment share one */
const toonHosts = new Map<string, HeldView>();
/** decoded maps and decals by immutable path, while some rig still holds them */
const images = new Map<string, Promise<Texture>>(), resolved = new Map<string, Texture>(), atlases = new Map<string, Texture>();

/** A row's rig contract and joint bake: graph rows list their joint sets, toon rows spell theirs out by side, arm and finger. */
function rigOf(row: HeldViewRow): { readonly contract: RigContract; readonly bake: RigBake } {
  const skeleton = row.kind === 'graph' ? row.rig.skeleton : row.skeleton, clips = row.kind === 'graph' ? ARM_CLIPS : TOON_CLIPS;
  const j = row.kind === 'toon' ? row.joints : null;
  const joints = j === null ? row.kind === 'graph' ? row.rig.joints : [] : [j.sides.flatMap(side => [...j.arm].concat(
    j.fingers.flatMap(finger => Array.from({ length: j.phalanges }, (_, i) => i + 1).map(i => `${finger}${i}`))).map(name => `${side}_${name}`))];
  return { contract: { skeleton, clips: armClipNames(clips), sockets: [...row.kind === 'graph' ? row.rig.sockets : row.sockets] }, bake: { skeleton, clips, joints } };
}

/** a rigid mesh drawn in one of `hulls` (NF15: it draws skinned, `skinRigid`) */
function rigidHull(node: Object3D, hulls: ReadonlySet<unknown>): node is Mesh {
  if (!(node instanceof Mesh) || node instanceof SkinnedMesh) return false;
  const material: unknown = node.material;
  return (Array.isArray(material) ? material : [material]).some((entry: unknown) => hulls.has(entry));
}

/** The looks a row's meshes are dressed in, borrowed for the context's scope; every id must be in the product's catalogue. */
async function lookMaterials(context: Parameters<typeof runtimeLookMaterials>[0], product: Pick<ShardFolder, 'shardfile'>, ids: readonly string[]): Promise<Looks> {
  const looks = await runtimeLookMaterials(context, product.shardfile, true, ids);
  if (context.scope.disposed) throw new Error('Held view scope unloaded during preparation');
  const missing = ids.filter(id => !looks.materials.has(id));
  if (missing.length > 0) throw new Error(`Held view: look.materials lacks ${missing.join(', ')}`);
  // its graph looks compile one a step, not all in the frame that first dresses the rig
  await looks.prepare?.(ids);
  return looks;
}

/** A rig's maps: the tier's KTX2 stand-in, else the image; numeric data, file orientation, trilinear. */
function loadMap(path: string, anisotropy: number): Promise<Texture> {
  const kept = resolved.get(path); if (kept !== undefined && !app.assets.isAcquired(kept)) images.delete(path);
  let loading = images.get(path);
  if (loading === undefined) {
    loading = (async () => {
      // OF17: a form that fails to read gives way to the other when the cache holds it
      const served = phoneUrl(path);
      const read = await readHeldForm(served, tex => ktx2Texture(served, Infinity, tex), instead => fetchImage(path, Infinity, false, false, instead));
      const value = read instanceof CompressedTexture ? read : new Texture(read);
      value.colorSpace = NoColorSpace; value.flipY = false; value.minFilter = LinearMipmapLinearFilter; value.anisotropy = anisotropy; value.needsUpdate = true;
      resolved.set(path, value);
      return retainCachedResources(value);
    })();
    images.set(path, loading);
  }
  return loading;
}

/** An R8 weave of size² texels, repeating and mipmapped. */
function weave(data: Uint8Array, size: number): DataTexture {
  if (data.length !== size * size) throw new Error(`Held weave must contain ${size} × ${size} R8 texels`);
  const texture = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  texture.wrapS = texture.wrapT = RepeatWrapping; texture.minFilter = LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

/** a toon rig's live looks and the day lighting their family uniforms follow */
interface Loan { readonly looks: Looks; readonly light: { readonly source: ReturnType<typeof toonLighting>;
  readonly target: Pick<ToonLookUniforms, 'famToonLift' | 'famToonRim' | 'famToonCloud' | 'famToonWater' | 'famToonTime'> } }
function followLight(loan: Loan): void {
  const u = loan.light.source, t = loan.light.target;
  t.famToonLift.value.copy(u.uToonLift.value); t.famToonRim.value.copy(u.uToonRim.value);
  t.famToonCloud.value.x = u.uCloudShadow.value; t.famToonWater.value.x = u.uSeaLevel.value; t.famToonTime.value = u.uCloudTime.value;
}
/** a toon rig's three meshes: the arms and the two blades (one primitive each) */
function armMeshes(rig: DressedRig): Mesh[] {
  const meshes = rig.meshes();
  if (meshes.length !== 3) throw new Error('Unexpected toon arm mesh count');
  return meshes;
}

/** A graph rig dressed from its row: the swing trail and the per-frame look writes. */
class GraphRig {
  readonly trail: { readonly mesh: Mesh };
  private readonly ribbon: SlashTrail;
  private trailLife: number;
  private t = 0;
  private readonly base = new Vector3();
  private readonly tip = new Vector3();
  private readonly buffer = [0, 0];
  private ratio = Number.NaN;
  private readonly projection = [0, 0, 0, 0];
  /** each loaded look's declared params */
  private readonly params: readonly (readonly [string, ReadonlySet<string>])[];

  constructor(readonly rig: RigArms, private readonly row: Graph, private readonly looks: Looks, ids: readonly string[]) {
    this.params = ids.map(id => [id, new Set(row.params[id])] as const);
    const material = looks.materials.get(row.trail.look);
    if (material === undefined) throw new Error(`Missing held trail look ${row.trail.look}`);
    this.ribbon = new SlashTrail({ samples: row.trail.samples, subdivisions: row.trail.subdivisions, movementSq: row.trail.movementSq, channel: 'age' });
    this.trailLife = row.trail.total * row.trail.life;
    this.trail = { mesh: new Mesh(this.ribbon.geometry, material) };
    this.trail.mesh.frustumCulled = false; this.trail.mesh.renderOrder = row.trail.order; this.trail.mesh.visible = false;
    rig.root.add(this.trail.mesh);
  }

  /** The held camera's projection to the `projection` frame rows, from each drawn mesh's own hook: three's node handler
   *  replaces `material.onBeforeRender` at every draw, so a material hook never ran and the ink hulls projected with
   *  the param's default (NR1: black copies off the arms). Call once the pendants hang. */
  bindProjection(): void {
    if (!this.row.frame.some(entry => entry.source === 'projection')) return;
    const looks = new Set<unknown>(this.looks.materials.values()), out = this.projection;
    const hook = (_renderer: unknown, _scene: unknown, camera: { readonly projectionMatrix: { readonly elements: readonly number[] } }): void => {
      const p = camera.projectionMatrix.elements;
      if (out[0] === p[0] && out[1] === p[5] && out[2] === p[10] && out[3] === p[14]) return;
      out[0] = p[0] ?? 0; out[1] = p[5] ?? 0; out[2] = p[10] ?? 0; out[3] = p[14] ?? 0;
      for (const entry of this.row.frame) if (entry.source === 'projection') this.write(entry, out);
    };
    this.rig.root.traverse(node => { if (node instanceof Mesh && [node.material].flat().some(material => looks.has(material))) node.onBeforeRender = hook; });
  }

  /** a frame row's value to its look, or to every look that declares its param */
  private write(entry: Graph['frame'][number], value: GraphLiteral): void {
    if (entry.look !== undefined) { this.looks.setParam(entry.look, entry.param, value); return; }
    for (const [id, names] of this.params) if (names.has(entry.param)) this.looks.setParam(id, entry.param, value);
  }

  /** a swing began: a fresh ribbon, its life from the clip's timing, a new seed */
  beginTrail(): void {
    const name = this.rig.move ?? 'light'; this.ribbon.reset();
    this.trailLife = (this.rig.meta.clips[name]?.timing?.total ?? this.row.trail.total) * this.row.trail.life;
    this.looks.setParam(this.row.trail.look, this.row.trail.seed, app.rng.stream('cosmetic').next() * 100);
  }

  setClawVisible(on: boolean): void { for (const mesh of this.rig.meshes()) if (mesh.name.startsWith(this.row.claw)) mesh.visible = on; }

  /** the drawing buffer's size and pixel ratio, to the `buffer` and `pixels` frame rows (written when they change, like
   *  the projection rows: the held update asks every frame) */
  resize(bw: number, bh: number, pr: number): void {
    if (this.buffer[0] === bw && this.buffer[1] === bh && this.ratio === pr) return;
    this.buffer[0] = bw; this.buffer[1] = bh; this.ratio = pr;
    for (const entry of this.row.frame) {
      if (entry.source === 'buffer') this.write(entry, this.buffer);
      else if (entry.source === 'pixels') this.write(entry, Math.max(entry.min ?? -Infinity, pr * (entry.scale ?? 1)));
    }
  }

  /** the look's clock, and the trail sampled along the blade through the move's swing window */
  advanceLook(dt: number): void {
    this.t += dt;
    for (const entry of this.row.frame) if (entry.source === 'time') this.write(entry, this.t);
    const name = this.rig.move, clip = name === null ? undefined : this.rig.meta.clips[name], timing = clip?.timing;
    if (timing !== null && timing !== undefined && this.rig.time >= timing.windup && this.rig.time <= timing.slashEnd) {
      const from = clip !== undefined && 'trailFrom' in clip && typeof clip.trailFrom === 'number' ? clip.trailFrom : this.row.trail.from;
      this.rig.blade(this.base, this.tip, from); this.ribbon.sample(this.base, this.tip, this.t);
    }
    this.trail.mesh.visible = this.ribbon.rebuild(this.t, this.trailLife);
  }
}

/** One held view: its admitted row, rig contract and bake, and (toon) its live look loans, newest last. */
export class HeldView {
  readonly contract: RigContract;
  readonly bake: RigBake;
  private readonly loans: Loan[] = [];

  readonly row: HeldViewRow;
  /** Admit a row (a graph row's files are read from `slug`'s product). */
  constructor(input: unknown, private readonly slug: string | null = null) { this.row = parseHeldView(input); ({ contract: this.contract, bake: this.bake } = rigOf(this.row)); }

  /** Admit a toon row once per id: a manifest's lazy sword provider and the kit stage share its host. */
  static admit(input: unknown): HeldView {
    const host = new HeldView(input);
    if (host.row.kind !== 'toon') throw new Error('A graph held view is read from its product (HeldView.fromFolder)');
    const ready = toonHosts.get(host.row.id); if (ready !== undefined) return ready;
    toonHosts.set(host.row.id, host); return host;
  }

  /** Admit a product's graph held view (`file`'s `view`). */
  static async fromFolder(slug: string, file: string): Promise<HeldView> {
    const product = await loadFirstPartyFolder(slug);
    return new HeldView({ kind: 'graph', ...(await product.json<{ readonly view: object }>(file)).view }, slug);
  }

  private get toon(): Toon { if (this.row.kind !== 'toon') throw new Error('A toon held view row is required'); return this.row; }

  /** Toon preparation inside the platform context: borrow the row's looks for the context's scope. */
  async prepare(context: Pick<ShardContext, 'scope' | 'game' | 'product'>): Promise<ReadonlyMap<string, Material>> {
    return this.keep(context.scope, await lookMaterials(context, context.product, Object.values(this.toon.materials)));
  }

  /** Cold Explorer preparation uses its standard platform context and the same admitted look ids. */
  async prepareExplorer(context: ModelContext, product: ShardFolder): Promise<void> {
    if (this.loans.length > 0) return;
    if (context.renderer === null) throw new Error('Held view Explorer needs its renderer');
    const scope = resourceScope().child('held-view-explorer');
    this.keep(scope, await lookMaterials({ scope, renderer: context.renderer }, product, Object.values(this.toon.materials)));
  }

  private keep(scope: Scope, looks: Looks): ReadonlyMap<string, Material> {
    const loan: Loan = { looks, light: { source: toonLighting(this.toon.lighting), target: looks.toon.uniforms } };
    this.loans.push(loan);
    scope.onDispose(() => { const at = this.loans.indexOf(loan); if (at !== -1) this.loans.splice(at, 1); });
    return looks.materials;
  }

  /** a draw hook's dressing loan while it is still lent. Hooks hold it weakly: the arms are page-wide and outlive the shard
   *  that lent the looks (live P0: they kept a retired Driftwood's graphs, and through them its scope, alive) */
  private lent(dressed: WeakRef<Loan>): Loan | null {
    const loan = dressed.deref();
    return loan !== undefined && this.loans.includes(loan) ? loan : null;
  }

  private loan(): Loan {
    const loan = this.loans.at(-1);
    if (loan === undefined) throw new Error('Held view: no looks prepared (prepare the context before dressing arms)');
    return loan;
  }

  /** A toon look by declared identity, resolved only after the host's scoped preparation. */
  materialById(id: string): Material {
    const m = this.loan().looks.materials.get(id);
    if (m === undefined) throw new Error(`Held view: look.materials lacks ${id}`);
    return m;
  }

  /** toon blades and arms on a rig: the blades' params, and once a frame (the arms' draw) the look's light follow and
   *  the shadow lookup toward the light */
  private dressToon(sky: Sky, rig: DressedRig): void {
    const L = this.toon, ids = L.materials, loan = this.loan(), set = loan.looks.setParam;
    for (const kind of ['wood', 'iron'] as const) {
      const node = rig.nodes.get(`sword_${kind}`);
      set(ids[kind], 'bladeDq', [node?.scale.x ?? 1, node?.position.y ?? 0]);
      set(ids[kind], 'bladeBase', rig.meta.swords[kind]?.bladeBase ?? L.bladeBase);
    }
    // the one vector the day / night clock copies the sun (or the moon) into
    const frame = this.armsFrame(new WeakRef(loan), sky.csm.lightDirection);
    this.dressMeshes(rig, mesh => this.materialById(mesh.name === 'sword_iron' ? ids.iron : mesh.name === 'sword_wood' ? ids.wood : ids.arms), frame, true);
  }
  /** the arms' draw hook (made here, outside `dressToon`, whose context holds its loan): the look's light follow and the
   *  shadow lookup toward the light, through the dressing loan while it is still lent */
  private armsFrame(dressed: WeakRef<Loan>, lightDir: Vector3): () => void {
    const L = this.toon, ids = L.materials, sunward = [0, 0, 0];
    return () => {
      const loan = this.lent(dressed);
      if (loan === null) return;
      followLight(loan);
      const set = loan.looks.setParam;
      sunward[0] = -lightDir.x * L.sunward; sunward[1] = -lightDir.y * L.sunward; sunward[2] = -lightDir.z * L.sunward;
      set(ids.arms, 'sunward', sunward); set(ids.wood, 'sunward', sunward); set(ids.iron, 'sunward', sunward);
    };
  }

  /** every toon arm mesh in its look, receiving shadow; the arms (not the blades) run `frame` as they draw. `held` blades
   *  read the GLB's per-vertex metalness as `aMetal` and stay out of the AO's transparency pre-pass */
  private dressMeshes(rig: DressedRig, look: (mesh: Mesh) => Material, frame: () => void, held: boolean): void {
    for (const mesh of armMeshes(rig)) {
      const geometry = mesh.geometry;
      if (held && geometry.hasAttribute('_metal')) { geometry.setAttribute('aMetal', geometry.getAttribute('_metal')); geometry.deleteAttribute('_metal'); }
      mesh.material = look(mesh); mesh.castShadow = false; mesh.receiveShadow = true;
      if (held) mesh.userData['treatAsOpaque'] = true;
      if (mesh.name !== 'sword_iron' && mesh.name !== 'sword_wood') mesh.onBeforeRender = frame;
    }
  }

  /** the swimming hands on a toon rig (Hands.ts): the swim clips, the projection, the water line */
  private swimArms(rig: DressedRig): SwimArms {
    const S = this.toon.swim, id = this.toon.materials.swim;
    const n = new Vector3(0, 1, 0), plane = [0, 1, 0];
    const waterY = rig.meta.water?.y ?? S.waterY;
    const q = new Quaternion(), up = new Vector3();
    let dressed: WeakRef<Loan> | null = null; // the swim look's loan, held weakly (see `lent`)
    rig.weapon(null);
    return {
      root: rig.root,
      setup: () => {
        const loan = this.loan(), m = this.materialById(id);
        loan.looks.setParam(id, 'waterD', S.startD);
        const weak = new WeakRef(loan); dressed = weak;
        this.dressMeshes(rig, () => m, () => { const current = this.lent(weak); if (current !== null) followLight(current); }, false);
      },
      update: (dt, s: { stroke: number; phase: number; camera: PerspectiveCamera; eyeAbove: number }) => {
        const k = vmScale(s.camera.fov);
        rig.root.scale.set(k, k, 1);
        rig.root.position.set(0, 0, 0);
        rig.swim(dt, s.stroke, s.phase);
        const loan = dressed === null ? null : this.lent(dressed);
        if (loan === null) return;
        const set = loan.looks.setParam;
        // the water plane in view space: the world's up turned into the camera (a third of the pitch: the arms are held to
        // the surface, not to the head), through the hands at the height the clips were framed on (scaled by the
        // projection), and tipped up toward the eye so the forearms in the lower corners ride above it — every point under
        // it when the eye itself is under the surface
        up.set(0, 1, 0).applyQuaternion(s.camera.getWorldQuaternion(q).invert());
        n.set(up.x * 0.35, 1, up.z * 0.35 + S.tilt).normalize();
        plane[0] = n.x; plane[1] = n.y; plane[2] = n.z;
        set(id, 'waterN', plane);
        set(id, 'waterD', s.eyeAbove < 0.02 ? 50 : n.y * waterY * k + n.z * S.handsZ);
      },
    };
  }

  /** A graph rig: admitted looks, maps, weave and decal, its meshes dressed and its pendants hung, under a fresh scope. */
  private async graphRig(): Promise<GraphRig> {
    const row = this.row, render = app.render, folderSlug = this.slug ?? '';
    if (row.kind !== 'graph' || folderSlug.length === 0) throw new Error('A graph held view is read from its product (HeldView.fromFolder)');
    if (render === null) throw new Error('Held graphs require the render service');
    const owner = resourceScope(), product = await loadFirstPartyFolder(folderSlug), tier = render.tier, R = row.rig;
    const ids = [...new Set([...row.meshes.map(mesh => mesh.look), ...row.pendants.materials, row.trail.look])];
    const looks = await lookMaterials({ scope: owner, renderer: render.renderer }, product, ids);
    const rig = await RigArms.load(R.url, this.contract, this.bake, false,
      { aliases: ARM_CLIPS, holdRight: R.holdRight, holdLeft: R.holdLeft, walkRate: R.walkRate, lag: R.lag, blade: row.blade,
        // NF15: a rigid ink hull (a weapon's) draws through the skinned hulls' program
        skinRigid: name => row.meshes.some(mesh => mesh.name === name && mesh.hull) });
    const silk = owner.own(weave(await product.file(row.weave.file), row.weave.size));
    const key = product.url(row.decal.files[tier]);
    let decal = atlases.get(key);
    if (decal !== undefined && !app.assets.isAcquired(decal)) decal = undefined;
    if (decal === undefined) { decal = retainCachedResources(await loadTextureRow({ url: key, srgb: true, anisotropy: 8, wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping })); atlases.set(key, decal); }
    ownSceneResource(decal, owner, app.assets);
    const maps = new Map(await Promise.all(row.maps.names.map(async name => [name, await Promise.all((['maps', 'nrm'] as const).map(async kind => {
      const texture = await loadMap(`${row.maps.base}${name}-${kind}.webp`, row.maps.anisotropy);
      ownSceneResource(texture, owner, app.assets); return texture;
    }))] as const)));
    const back = new Set(row.back), additive = new Set(row.additive);
    for (const id of ids) {
      const names = new Set(row.params[id]), material = looks.materials.get(id);
      if (material === undefined) throw new Error(`Missing held material ${id}`);
      if (names.has(row.weave.param)) looks.setTexture(id, row.weave.param, silk);
      if (names.has(row.decal.param)) looks.setTexture(id, row.decal.param, decal);
      if (back.has(id)) material.side = BackSide;
      if (additive.has(id)) material.setValues({ ...BLEND_ADD_KEEP_ALPHA, transparent: true, depthWrite: false });
    }
    for (const mesh of rig.meshes()) {
      const entry = row.meshes.find(candidate => candidate.name === mesh.name), material = entry === undefined ? undefined : looks.materials.get(entry.look);
      if (entry === undefined || material === undefined) throw new Error(`Missing held mesh row ${mesh.name}`);
      for (const [name, source] of Object.entries(entry.channels)) if (mesh.geometry.hasAttribute(source)) { mesh.geometry.setAttribute(name, mesh.geometry.getAttribute(source)); if (source.startsWith('_')) mesh.geometry.deleteAttribute(source); }
      mesh.material = material; material.side = entry.hull ? BackSide : entry.doubleSide ? DoubleSide : material.side;
      if (entry.hull) mesh.renderOrder = -1;
      const [map, normal] = entry.maps === undefined ? [] : maps.get(entry.maps) ?? [];
      if (map !== undefined) looks.setTexture(entry.look, row.maps.kinds.maps, map);
      if (normal !== undefined) looks.setTexture(entry.look, row.maps.kinds.nrm, normal);
    }
    const result = new GraphRig(rig, row, looks, ids);
    const geometry = new Map<string, BufferGeometry>();
    for (const source of row.pendants.geometry) {
      const pool = { ...source, files: source.files.filter(file => file.tier === undefined || file.tier === tier) };
      const library = worldScenePool(product, pool);
      await library.preload();
      for (const name of pool.files.flatMap(file => file.parts)) {
        if (geometry.has(name)) throw new Error(`Repeated held rest geometry ${name}`);
        const part = library.geometry(name);
        if (part === null) throw new Error(`Missing held rest geometry ${name}`);
        geometry.set(name, owner.own(part));
      }
    }
    const socket = rig.nodes.get(row.pendants.socket);
    if (socket === undefined) throw new Error(`Held pendant socket ${row.pendants.socket} is missing`);
    const pendants = createClientScene(row.pendants.scene, { geometry, materials: looks.materials }).root;
    socket.add(pendants);
    // NF15: the pendants' rigid ink hulls (the knot's) draw through the skinned hulls' program too (skinRigid)
    const hulls = new Set<unknown>(row.back.map(id => looks.materials.get(id))), rigidHulls: Mesh[] = [];
    pendants.traverse(node => { if (rigidHull(node, hulls)) rigidHulls.push(node); });
    for (const mesh of rigidHulls) skinRigid(mesh);
    result.bindProjection();
    owner.own(result.trail.mesh.geometry);
    return result;
  }

  /** The rigs as ShardManifest.sword: toon's wooden and iron blades and swimming hands, or the graph rig with its own trail. */
  async sword(): Promise<ShardSword> {
    if (this.row.kind === 'graph') {
      const graph = await this.graphRig(); graph.rig.root.traverse(node => { node.userData['treatAsOpaque'] = true; });
      const arms = swordArmsOf(graph.rig, {});
      return { arms: { ...arms, engineTrail: false,
        play: move => { arms.play(move); graph.beginTrail(); },
        playLeft: name => { graph.rig.playLeft(name); }, setClawVisible: visible => { graph.setClawVisible(visible); },
        update: (dt, state) => { const r = state.renderer; graph.resize(r.domElement.width, r.domElement.height, r.getPixelRatio()); arms.update(dt, state); graph.advanceLook(dt); },
      } };
    }
    const L = this.row, url = L.url;
    const [wood, iron, swim] = await Promise.all([RigArms.load(url, this.contract, this.bake), RigArms.load(url, this.contract, this.bake), RigArms.load(url, this.contract, this.bake, true)]);
    const blade = (rig: RigArms, kind: Blade) => {
      rig.weapon(kind);
      /** the held blade's glow: its edges lit */
      return { ...swordArmsOf(rig, { offset: new Vector3(...L.offset), frame: { ...L.frame }, setup: (sky: Sky) => { this.dressToon(sky, rig); } }),
        glow: (level: number) => { this.loan().looks.setParam(L.materials[kind], 'rim', level); } };
    };
    return { arms: blade(wood, 'wood'), ironArms: blade(iron, 'iron'), swim: this.swimArms(swim) };
  }

  /**
   * A Model Explorer card, settled at rest with no walk or look: toon arms hold `blade` on their own skeleton clone, lit
   * by `sky`; graph arms step `settleFrames` through the idle so the cloth hangs, without the swing trail, every mesh
   * re-reading the drawing buffer it is drawn into. Out of the AO's transparency pre-pass, as held.
   */
  async specimen(options: { readonly sky: Sky; readonly blade: Blade } | { readonly settleFrames: number; readonly renderer: Renderer | null }): Promise<Object3D> {
    if ('blade' in options) {
      const rig = await RigArms.load(this.toon.url, this.contract, this.bake);
      rig.weapon(options.blade);
      this.dressToon(options.sky, rig);
      rig.update(0.4, still());
      return rig.root;
    }
    const graph = await this.graphRig(), state = still();
    for (let i = 0; i < options.settleFrames; i++) { graph.rig.update(1 / 60, state); graph.advanceLook(1 / 60); }
    let bw = 0, bh = 0, pr = 0;
    const fit = (r: Renderer): void => {
      const c = r.domElement, p = r.getPixelRatio();
      if (c.width === bw && c.height === bh && p === pr) return;
      bw = c.width; bh = c.height; pr = p;
      graph.resize(bw, bh, pr);
    };
    if (options.renderer !== null) fit(options.renderer);
    graph.trail.mesh.removeFromParent();
    graph.rig.root.traverse(node => {
      node.userData['treatAsOpaque'] = true;
      if (node instanceof Mesh) node.onBeforeRender = (r: Renderer) => { fit(r); };
    });
    return graph.rig.root;
  }
}
