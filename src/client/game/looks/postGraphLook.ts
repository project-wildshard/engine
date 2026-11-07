import { parsePostGraphDocument } from '@wildshard/format/postGraphDocument';
import { PainterlyWorldSchema } from '@wildshard/format/paintedResources';
/**
 * A post-graph look (G599 N1, format/postGraphLook rows): a level's whole colour chain as scaled post graph passes on the
 * engine's composer. Its side passes (on the tiers they name) draw into their own targets before the chain; a draw-free
 * uniforms pass lends their outputs to the composite (black where a side did not draw) and raises the declared presence
 * flags; the composite draws the frame and the chain's one effect displays it. The same composite runs inside a grid cell,
 * where it is the whole colour chain and shades in the cell root's frame. Every uniform comes from the row's bag: its own
 * rows, the level's lent live set, the LUT, the side textures and the aliases. With a `scene` row it is a 'replace' look:
 * its own composer (the tier's MSAA) holds the scene pass, the sides (the engine's bloom blur among them), the graphs and
 * the displayed frame, and
 * its grid cell carries the same composite. Client-only presentation.
 */
import { Color, type Data3DTexture, DataTexture, Fog, NoColorSpace, Vector2, Vector3, Vector4, type IUniform, type Object3D, type PerspectiveCamera, Texture, type WebGLRenderTarget, type Scene } from 'three';
import { BlendFunction, BloomEffect, EffectPass, LookupTexture, Pass, RenderPass, TextureEffect } from 'postprocessing';
import * as v from 'valibot';
import { FrameCamera } from '@wildshard/engine/world/frameCamera';
import { loadCarriedLUT } from '@wildshard/engine/boot/bakedApi';
import { LUT_SIZE } from '@wildshard/engine/render/lut';
import type { FogModel, GrassDriver, LookCellComposite, LookStrategy, SkyDressing, TerrainPainter, WorldLookContext } from '@wildshard/engine/render/look';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { headingTexture } from '@wildshard/engine/render/dataLook';
import { ColourRampFog, panoramaTint } from '@wildshard/engine/world/Atmosphere';
import { smoothstep } from '@wildshard/engine/core/noise';
import type { Events } from '@wildshard/engine/events/events';
import type { Scope } from '@wildshard/engine/app/scope';
import { TIER, TIER_CONFIG, type Tier } from '@wildshard/engine/core/tier';
import type { Renderer } from '@wildshard/engine/render/renderer';
import { PaintedWorldSchema, type PostGraphEffect, type PostGraphLookRow, type PostGraphWrite } from '@wildshard/format/postGraphLook';
import type { ScaledPostRow } from '@wildshard/format/scaledPost';
import { uniformsFrom, type UniformMap } from '../plugin/shaderFamily';
import { ScaledPostPass, precompileScaledPost, prepareScaledPost } from './scaledPost';
import { hasLentLook, lendUniforms, lentUniforms, setLentParam, setLentTexture } from '../shardfile/lentLooks';
import { paintedAir } from './paintedLook';
import { PaintedPanorama, PainterKeyLight, paintedGroundPainter, type PainterSkyLook } from './painterlyLook';
import { GrassPresentation, GrassPresentationProfile } from './grassPresentation';
import { GrassPresentationSchema, grassPresentationFiles } from '@wildshard/format/fieldPresentation';
import { readFileInputs } from '../../../shared/game/shardfile/fileInputs';
import { StaticCapture, staticCaptureUniforms, type StaticCaptureUniforms } from './staticCapture';
import { installChannelPrograms } from '../../../shared/game/plugin/channelPrograms';
import { graphParamRoots } from './graphDaySky';

/** a side target no pass drew reads as black */
const black = new DataTexture(new Uint8Array(4), 1, 1);
black.needsUpdate = true;

function need(bag: UniformMap, name: string): IUniform {
  const uniform = bag[name];
  if (uniform === undefined) throw new Error(`Post-graph look has no uniform ${name}`);
  return uniform;
}
function passRow(row: PostGraphLookRow, name: string): ScaledPostRow {
  const pass = row.passes[name];
  if (pass === undefined) throw new Error(`Post-graph look has no pass ${name}`);
  return pass;
}
const RGB = ['r', 'g', 'b'] as const;
function channel(index: number): 'r' | 'g' | 'b' {
  const key = RGB[index];
  if (key === undefined) throw new Error('Post-graph colour component is 0, 1 or 2');
  return key;
}
function component(value: unknown, index: number): number {
  if (value instanceof Vector2 || value instanceof Vector3 || value instanceof Vector4) return value.getComponent(index);
  if (value instanceof Color) return value[channel(index)];
  throw new Error('Post-graph component write needs a vector or a colour');
}
function setComponent(value: unknown, index: number, to: number): void {
  if (value instanceof Vector2 || value instanceof Vector3 || value instanceof Vector4) value.setComponent(index, to);
  else if (value instanceof Color) value[channel(index)] = to;
  else throw new Error('Post-graph component write needs a vector or a colour');
}
/** a write's current value(s), to hold */
function read(bag: UniformMap, write: PostGraphWrite): number | number[] {
  const value: unknown = need(bag, write.param).value;
  if (write.each === true && Array.isArray(value)) return value.map((item: unknown) => component(item, write.index ?? 0));
  if (write.index !== undefined) return component(value, write.index);
  if (typeof value !== 'number') throw new Error(`Post-graph write ${write.param} needs a number`);
  return value;
}
function put(bag: UniformMap, write: PostGraphWrite, to: number | readonly number[]): void {
  const uniform = need(bag, write.param), value: unknown = uniform.value;
  if (write.each === true && Array.isArray(value)) value.forEach((item: unknown, i) => { setComponent(item, write.index ?? 0, typeof to === 'number' ? to : to[i] ?? 0); });
  else if (write.index !== undefined) setComponent(value, write.index, typeof to === 'number' ? to : to[0] ?? 0);
  else uniform.value = typeof to === 'number' ? to : to[0] ?? 0;
}

/** The engine's bloom blur as a side (draw into its own targets, no swap): the scene colour's light over the threshold,
 *  mip-blurred; its output `bloom` is that light, which the composite blends as the bloom effect would (screen). */
class BloomSide extends Pass {
  private readonly bloom: BloomEffect;
  constructor(row: { readonly threshold: number; readonly smoothing: number; readonly radius: number; readonly levels?: number }) {
    super('PostGraphBloom');
    this.needsSwap = false;
    this.bloom = new BloomEffect({ luminanceThreshold: row.threshold, luminanceSmoothing: row.smoothing, mipmapBlur: true, radius: row.radius, levels: row.levels ?? TIER_CONFIG.bloomLevels });
  }
  output(name: string): Texture | null { return name === 'bloom' ? this.bloom.texture : null; }
  override initialize(renderer: Renderer, alpha: boolean, frameBufferType: number): void { this.bloom.initialize(renderer, alpha, frameBufferType); }
  override setSize(width: number, height: number): void { this.bloom.setSize(width, height); }
  override render(renderer: Renderer, input: WebGLRenderTarget | null): void { if (input !== null) this.bloom.update(renderer, input); }
  override dispose(): void { this.bloom.dispose(); super.dispose(); }
}
type Side = ScaledPostPass | BloomSide;

/** (draw-free) the side outputs lent to the composite and its presence flags, after the view is posed */
class SideInputs extends Pass {
  constructor(private readonly row: PostGraphLookRow, private readonly sides: ReadonlyMap<string, Side>, private readonly bag: UniformMap, private readonly pose: (() => void) | null) {
    super('PostGraphInputs');
    this.needsSwap = false;
  }
  override render(): void {
    this.pose?.();
    const drawn = new Set<string>();
    for (const [name, input] of Object.entries(this.row.inputs)) {
      const side = this.sides.get(input.side), texture: Texture | null = side?.enabled === true ? side.output(input.output) : null;
      need(this.bag, name).value = texture ?? black;
      if (texture !== null) drawn.add(name);
    }
    for (const [name, flag] of Object.entries(this.row.flags ?? {})) need(this.bag, name).value = flag.inputs.every(input => drawn.has(input)) ? flag.on : 0;
  }
}
/** (draw-free) poses the cell root's view before the side passes read it */
class PoseView extends Pass {
  constructor(private readonly pose: () => void) {
    super('PostGraphPoseView');
    this.needsSwap = false;
  }
  override render(): void { this.pose(); }
}

/** the identity grade a look reads until its learned LUT loads */
export function neutralLut(): Data3DTexture {
  const texture = LookupTexture.createNeutral(LUT_SIZE).convertToUint8(); texture.colorSpace = NoColorSpace;
  return texture;
}
/** a learned LUT through the engine's one reader; a missing shipped grade refuses */
export async function loadPostGraphLut(url: string, name: string): Promise<Data3DTexture> {
  const texture = await loadCarriedLUT(url, name);
  if (texture === null) throw new Error(`Missing post-graph LUT: ${url}`);
  return texture;
}

interface Built { readonly display: TextureEffect; readonly sides: ReadonlyMap<string, Side>; readonly passes: readonly Pass[]; readonly bag: UniformMap }

/** Bind a look's declared event edges over its bag and displayed frame: `hold` values come back on `off` and when `scope` ends. */
export function bindPostGraphEvents(rows: PostGraphLookRow['events'], bag: UniformMap, display: Pick<TextureEffect, 'blendMode'>, events: Pick<Events, 'on'>, scope: Scope): void {
  for (const event of rows ?? []) {
    let held: { readonly write: PostGraphWrite; readonly value: number | number[] }[] | null = null;
    const restore = (): void => { for (const { write, value } of held ?? []) put(bag, write, value); held = null; };
    const apply = (effect: PostGraphEffect): void => {
      for (const write of effect.set ?? []) put(bag, write, write.value);
      if (effect.display !== undefined) display.blendMode.opacity.value = effect.display;
    };
    events.on(event.event, (on) => {
      if (on) {
        if (held === null && event.on.hold !== undefined) {
          held = event.on.hold.map(write => ({ write, value: read(bag, write) }));
          for (const write of event.on.hold) put(bag, write, write.value);
        }
        apply(event.on);
      } else { restore(); apply(event.off); }
    }, scope);
    scope.onDispose(restore);
  }
}

/** the camera facts a look's channel group reads as its 'view' owner */
interface FrameView { eyeX: number; eyeY: number; eyeZ: number; near: number; p00: number; p11: number; rootX: number; rootY: number; rootZ: number }
const point = new Vector3();
/** A look's declared channel group over a bag: the view and the bag's numbers it reads, then its outputs pushed into the
 *  bag's uniforms (a number, or a vector's or colour's components) and the lent graph looks' params it names. */
function frameChannels(rows: NonNullable<PostGraphLookRow['channels']>, bag: UniformMap): (camera: PerspectiveCamera, root: Object3D | null, time: number, delta: number) => void {
  const looks = [...new Set(rows.programs.flatMap(program => program.numeric?.group === rows.group ? program.numeric.outputs.map(out => out.target) : []))].filter(target => target !== 'bag');
  const lent = graphParamRoots(rows.programs, rows.group, looks), own = graphParamRoots(rows.programs, rows.group, ['bag']);
  const view: FrameView = { eyeX: 0, eyeY: 0, eyeZ: 0, near: 0, p00: 0, p11: 0, rootX: 0, rootY: 0, rootZ: 0 };
  const lane = installChannelPrograms(rows.programs, rows.group, new Map<string, unknown>([['view', view], ['uniforms', bag], ...lent.roots, ...own.roots]));
  const uniforms = { setParam: (_bag: string, name: string, value: number | number[]): void => {
    if (typeof value === 'number') { need(bag, name).value = value; return; }
    value.forEach((part, index) => { setComponent(need(bag, name).value, index, part); });
  } };
  return (camera, root, time, delta) => {
    point.setFromMatrixPosition(camera.matrixWorld); view.eyeX = point.x; view.eyeY = point.y; view.eyeZ = point.z;
    view.near = camera.near; view.p00 = camera.projectionMatrix.elements[0]; view.p11 = camera.projectionMatrix.elements[5];
    if (root === null) point.set(0, 0, 0); else point.setFromMatrixPosition(root.matrixWorld);
    view.rootX = point.x; view.rootY = point.y; view.rootZ = point.z;
    lane.evaluate({ time, delta, values: {} }); own.push(uniforms); lent.push({ setParam: setLentParam });
  };
}

function isTexture(value: unknown): value is Texture { return value instanceof Texture; }
/** A look's lent texture rows over a bag: each lent look's param takes its uniform's texture once, and again on a change. */
function lentTextures(rows: NonNullable<PostGraphLookRow['textures']>, bag: UniformMap): () => void {
  const given: (Texture | null)[] = rows.map(() => null);
  for (const row of rows) need(bag, row.uniform);
  return () => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i], value: unknown = row === undefined ? null : need(bag, row.uniform).value;
      if (row === undefined || value === given[i] || !hasLentLook(row.look)) continue;
      if (!isTexture(value)) throw new Error(`Post-graph texture row ${row.uniform} holds no texture`);
      setLentTexture(row.look, row.param, value); given[i] = value;
    }
  };
}

/** Read a level's post-graph look from its product file (`field` the path to its row) and make its strategy. */
export async function postGraphLook(product: { readonly slug: string; readonly json: (name: string) => Promise<unknown>; readonly file?: (name:string)=>Promise<Uint8Array> }, source: { readonly file: string; readonly field: readonly string[] }): Promise<LookStrategy> {
  const json=product.json,readFile=product.file,tier=TIER;
  const live=():void=>{if(product.json!==json||product.file!==readFile)throw new Error('Painted world product reader changed');};
  let at: unknown = await json.call(product,source.file);live();
  for (const key of source.field) at = typeof at === 'object' && at !== null ? Reflect.get(at, key) : undefined;
  const painted = parsePostGraphDocument(at).painted;
  const names=painted===undefined?[]:grassPresentationFiles(v.parse(GrassPresentationSchema,painted.grass.rows),tier);
  if(names.length>0&&readFile===undefined)throw new Error('Painted world product file reader required');
  const files=await readFileInputs(names,name=>{
    if(readFile===undefined)throw new Error('Painted world product file reader required');
    return readFile.call(product,name);
  },live);
  const look = postGraphLookOf(product.slug, at);
  // a painterly level's painted world (fog, ground, grass, sky) beside its graphs
  return painted === undefined ? look : { ...look, ...paintedWorld(product.slug, painted,files,tier).look };
}

/** A level's post-graph look from its admitted row (`slug` names its LUT): an engine-chain look, or with `scene` its own. */
/**
 * G924 (FC10's order, worldDepth.ts WorldRenderPass): the scene pass lets three clear its target after the shadow pass (the
 * background step, with autoClear) instead of the clear pass clearing it first. A target cleared and then left for the
 * shadow map is stored and loaded back by a tile GPU: on Nalati's phone frame that was a whole MSAA screen and a bind.
 */
class ShadowFirstRenderPass extends RenderPass {
  override render(renderer: Renderer, inputBuffer: WebGLRenderTarget | null, outputBuffer: WebGLRenderTarget | null, deltaTime?: number, stencilTest?: boolean): void {
    const clear = this.clearPass;
    if (inputBuffer === null || this.renderToScreen || !clear.enabled || clear.overrideClearColor !== null || clear.overrideClearAlpha !== -1) { super.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest); return; }
    // the renderer's own clear, put back as it was at the first clear of the scene target (nested renders keep theirs)
    const autoClear = renderer.autoClear, own: unknown = Reflect.get(renderer, 'clear');
    if (typeof own !== 'function') throw new Error('Renderer clear is not a function');
    let restored = false;
    const restore = (): void => { if (restored) return; restored = true; renderer.autoClear = autoClear; Reflect.set(renderer, 'clear', own); };
    Reflect.set(renderer, 'clear', (color?: boolean, depth?: boolean, stencil?: boolean): void => {
      if (renderer.getRenderTarget() === inputBuffer) restore();
      Reflect.apply(own, renderer, [color, depth, stencil]);
    });
    clear.enabled = false; renderer.autoClear = true;
    try { super.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest); } finally { clear.enabled = true; restore(); }
  }
}

export function postGraphLookOf(slug: string, input: unknown): LookStrategy {
  const row = parsePostGraphDocument(input);
  const lut: UniformMap = row.lut === undefined ? {} : { [row.lut.texture]: { value: neutralLut() }, [row.lut.amount]: { value: 0 } };
  if (row.lut !== undefined) {
    const { url, texture, amount } = row.lut;
    void (async (): Promise<void> => { need(lut, texture).value = await loadPostGraphLut(url, `${slug}-lut`); need(lut, amount).value = 1; })();
  }
  /** the latest build's bag and renderer, for the frame's channels and pixel terms, and its view seen from its root */
  let live: { readonly bag: UniformMap; readonly renderer: Renderer; readonly view: () => PerspectiveCamera; readonly root: Object3D | null;
    readonly channels: ReturnType<typeof frameChannels> | null; readonly textures: (() => void) | null } | null = null;
  const size = new Vector2();

  const build = (camera: PerspectiveCamera, tier: Tier, renderer: Renderer, root: Object3D | null, screen = false, buffer = false): Built => {
    const framed = root === null ? null : new FrameCamera(root);
    const view = framed?.pose(camera) ?? camera, pose = framed === null ? null : (): void => { framed.pose(camera); };
    const bag: UniformMap = { ...uniformsFrom(row.uniforms), ...(row.live === undefined ? {} : lentUniforms(row.live)), ...lut };
    for (const [alias, target] of Object.entries(row.aliases ?? {})) bag[alias] = need(bag, target);
    for (const name of Object.keys(row.inputs)) bag[name] = { value: black };
    const sides = new Map<string, Side>();
    for (const side of row.sides) {
      if (!side.tiers.includes(tier)) continue;
      if ('bloom' in side) { sides.set(side.bloom, new BloomSide(side)); continue; }
      const params = Object.fromEntries(Object.entries(side.params ?? {}).map(([key, link]) => [key, typeof link === 'number' ? { value: link } : need(bag, link)]));
      sides.set(side.pass, new ScaledPostPass(passRow(row, side.pass), { renderer, camera: view, links: { ...bag, ...uniformsFrom(side.constants ?? {}) }, params }));
    }
    const frame = new ScaledPostPass(passRow(row, row.composite.pass), { renderer, camera: view, links: bag, ...(screen ? { screen: row.composite.output } : {}),
      ...(buffer ? { buffer: row.composite.output } : {}) });
    const display = new TextureEffect({ texture: black, blendFunction: BlendFunction.SRC });
    const show = display.update.bind(display);
    display.update = (r, target, dt): void => { display.texture = frame.output(row.composite.output) ?? black; show(r, target, dt); };
    for (const lent of row.lent ?? []) setLentParam(lent.look, lent.param, sides.has(lent.side) ? lent.drawn : lent.absent);
    live = { bag, renderer, view: () => framed?.pose(camera) ?? camera, root, channels: row.channels === undefined ? null : frameChannels(row.channels, bag),
      textures: row.textures === undefined ? null : lentTextures(row.textures, bag) };
    return { display, sides, bag, passes: [...(pose === null ? [] : [new PoseView(pose)]), ...sides.values(), new SideInputs(row, sides, bag, pose), frame] };
  };

  const parts = {
    // the tier's side passes and the composite compile ahead, one program a step: a cell builds its composite in one frame
    prepareWorld: async ({ renderer, scope }: WorldLookContext) => {
      await prepareScaledPost(renderer);
      await precompileScaledPost(renderer, [...row.sides.flatMap(side => 'bloom' in side || !side.tiers.includes(TIER) ? [] : [passRow(row, side.pass)]), passRow(row, row.composite.pass)], scope);
    },
    ...(row.sky === undefined ? {} : { sky: row.sky }),
    cell: {
      replaces: 'chain',
      build: (c) => {
        const built = build(c.camera, c.tier, c.renderer, c.root);
        c.scope.onDispose(() => { if (live?.bag === built.bag) live = null; });
        return { display: built.display, passes: built.passes };
      },
    } satisfies LookCellComposite,
    /** the drawing buffer's pixel terms, then the declared channel group and the lent textures, before the frame draws */
    frame: (dt: number, t: number): void => {
      if (live === null) return;
      const { bag, renderer } = live, pr = renderer.getPixelRatio();
      for (const term of row.pixel ?? []) {
        if (term.of === 'buffer') { renderer.getDrawingBufferSize(size); const value: unknown = need(bag, term.param).value; if (value instanceof Vector2) value.copy(size); continue; }
        const value = term.of === 'step' ? (pr < term.at ? term.below : term.above) : pr * (term.scale ?? 1) * (term.below !== undefined && pr < term.below.at ? term.below.times : 1);
        put(bag, { param: term.param, ...(term.of === 'ratio' && term.index !== undefined ? { index: term.index } : {}), value }, value);
      }
      live.channels?.(live.view(), live.root, t, dt);
      live.textures?.();
    },
    dispose: (): void => { live = null; },
  };
  // its own composer: the scene pass, the sides, the graphs and the displayed frame (the tier's MSAA is the engine's)
  const gradeToScreen = !(row.events ?? []).some(event => event.on.display !== undefined || event.off.display !== undefined);
  if (row.scene !== undefined) return { ...parts, mode: 'replace', compose: (c) => {
    const built = build(c.camera, c.tier, c.renderer, null, gradeToScreen);
    bindPostGraphEvents(row.events, built.bag, built.display, c.app.events, c.scope);
    // G924: with no event fading the displayed frame, the composite grades straight to the screen (no frame target, no copy)
    return { chain: [new ShadowFirstRenderPass(c.scene, c.camera), ...built.passes, ...(gradeToScreen ? [] : [new EffectPass(c.camera, built.display)])] };
  } };
  return {
    ...parts,
    ...(row.lut === undefined ? {} : { lut: row.lut.url }),
    compose: (c) => {
      if (row.ao !== undefined && c.fx.ao !== null) {
        const [r, g, b] = row.ao.color;
        Object.assign(c.fx.ao.configuration, row.ao[c.tier], { color: new Color(r, g, b) });
        if (c.scene.fog instanceof Fog) [c.scene.fog.near, c.scene.fog.far] = row.ao.fog;
      }
      // G4: with no event fading the displayed frame, the composite draws into the composer's buffer and the engine's colour
      // pass reads it there (no frame target, no display copy: Nine's FXAA becomes the colour pass)
      const built = build(c.camera, c.tier, c.renderer, null, false, gradeToScreen);
      bindPostGraphEvents(row.events, built.bag, built.display, c.app.events, c.scope);
      return { beforeChain: [...built.passes], chain: gradeToScreen ? [] : [built.display] };
    },
  };
}

// G615 (Jake): the painted world of a painterly level, the post-graph look's optional `painted` row: the static capture's
// shade, the panorama fog (a colour ramp to its haze over the painted heading LUT, re-tinted live by the engine's panorama
// tint), the painted air (cloud shadows), the painted ground and the grass, all shaded by the one capture; built once per
// page per level slug, read by the level's world wiring by its slug (`paintedWorldOf`), which `wire`s its painterly world
// (the panorama dome, the painter's key light, the static capture, the grass's mood) from the optional `world` rows,
// lending the grade's live uniforms the post-graph look reads.

/**
 * A painterly world (the painterly look host, G478): the panorama and the painter's key over a static capture of the
 * level's `casters` (its groups by name and the caller's extra roots), swept every `sweep` s for streamed-in casters; on a
 * tier whose capture rows take statics off the realtime map, that map shrinks to `liveMap` texels. Each frame the key
 * swings, the capture re-keys from it, the panorama fades to night, the grass faces the sun and darkens with the hour
 * (dusk over `dusk` [from, to] degrees of sun) and the storm, the rig's night sky shows only at night, and the rig's sun
 * disc stays only as the moon.
 */

/** What the world reads each frame: the hour's look, the sun's elevation (degrees) and the storm's overcast. */
export interface PainterlyFrame { readonly look: PainterSkyLook; readonly sunElevation: number; readonly overcast: number }
/** The static capture as the world drives it (a `StaticCapture` from the level's capture rows, unless one is lent). */
export interface PainterlyCapture { readonly staticOffCsm: boolean; add: (root: Object3D) => void; sweep: () => void; update: (keyDir: Vector3) => void }
export class PainterlyWorld {
  private sweepT = 0;
  private constructor(private readonly rows: v.InferOutput<typeof PainterlyWorldSchema>, private readonly sky: SkyRig, private readonly capture: PainterlyCapture,
    readonly panorama: PaintedPanorama, private readonly key: PainterKeyLight, private readonly grass: GrassPresentationProfile, private readonly starOwner: Pick<PaintedWorldPorts, 'stars'>) {}
  static async build(input: unknown, ports: { readonly renderer: Renderer; readonly scene: Scene; readonly scope: Scope; readonly sky: SkyRig; readonly stars: Object3D;
    readonly groups: Readonly<Record<string, Object3D>>; readonly casters: readonly Object3D[]; readonly grass: GrassPresentationProfile;
    readonly capture: { readonly rows: unknown; readonly uniforms: StaticCaptureUniforms } | { readonly lent: PainterlyCapture }; readonly panorama: { readonly rows: unknown } & Parameters<typeof PaintedPanorama.build>[4];
    readonly key: { readonly rows: unknown; readonly daySaturation: number; readonly saturation: IUniform<number> } }): Promise<PainterlyWorld | null> {
    const rows = v.parse(PainterlyWorldSchema, input), { renderer, scene, scope, sky } = ports;
    const panorama = await PaintedPanorama.build(scene, Math.min(8, renderer.capabilities.getMaxAnisotropy()), scope, ports.panorama.rows, ports.panorama);
    if (panorama === null) return null;
    const key = new PainterKeyLight(ports.key.rows, sky, ports.key.daySaturation, ports.key.saturation);
    const capture = 'lent' in ports.capture ? ports.capture.lent : await StaticCapture.create(renderer, scene, ports.grass.heightTexture(), scope, ports.capture.rows, ports.capture.uniforms);
    for (const name of rows.casters) { const group = ports.groups[name]; if (group !== undefined) capture.add(group); }
    for (const root of ports.casters) capture.add(root);
    if (capture.staticOffCsm) {
      sky.csm.shadowMapSize = rows.liveMap;
      for (const light of sky.csm.lights) { light.shadow.mapSize.set(rows.liveMap, rows.liveMap); light.shadow.map?.dispose(); light.shadow.map = null; }
    }
    return new PainterlyWorld(rows, sky, capture, panorama, key, ports.grass, ports);
  }
  update(dt: number, frame: PainterlyFrame): void {
    const look = frame.look, stars = this.starOwner.stars;
    this.sweepT -= dt;
    if (this.sweepT <= 0) { this.sweepT = this.rows.sweep; this.capture.sweep(); }   // streamed-in casters join the capture
    this.key.apply(look);
    this.capture.update(this.sky.sunDir);   // after the key, so the captured shadows fall from it
    const night = this.panorama.update(look.sunDir, frame.sunElevation);
    this.grass.uniforms.uSunView.value.copy(look.sunDir);
    this.grass.mood(night, smoothstep(this.rows.dusk[0], this.rows.dusk[1], frame.sunElevation) * (1 - night), frame.overcast);
    stars.visible = night > 0.001;
    if (look.moon <= 0) this.sky.sunDisc.visible = false;   // the sun is painted; the disc stays only as the moon
  }
}

/** What a painted world lends its level: the parts its world wiring shares, and the look's parts. */
export interface PaintedWorldParts {
  readonly bake: StaticCaptureUniforms;
  /** the fog's heading LUT (scene-linear, half float, repeating round the azimuth), shared with the panorama dome */
  readonly fogLut: DataTexture;
  readonly tint: typeof panoramaTint;
  readonly grass: GrassPresentationProfile;
  readonly look: { readonly fog: FogModel; readonly terrainPainter: TerrainPainter; readonly grass: GrassDriver; readonly sky: SkyDressing };
  /** the level's world (its world wiring): lend the grade, build the painterly world (null: no world rows, or none built) */
  readonly wire: (ports: PaintedWorldPorts) => Promise<PainterlyWorld | null>;
}
/** The world-stage owners a painterly world draws into and follows. */
export interface PaintedWorldPorts {
  readonly renderer: Renderer; readonly scene: Scene; readonly scope: Scope; readonly sky: SkyRig; readonly stars: Object3D;
  readonly groups: Readonly<Record<string, Object3D>>; readonly casters: readonly Object3D[];
  /** the level's daytime saturation the key light eases from */
  readonly daySaturation: number;
}

const paintedWorlds = new Map<string, PaintedWorldParts>();

/** The painted world of the level `slug` from its rows (the post-graph look's `painted` row), built on the first call of
 *  the page. */
export function paintedWorld(slug: string, input: unknown, files:ReadonlyMap<string,Uint8Array>=new Map(), selected?: Tier): PaintedWorldParts {
  const had = paintedWorlds.get(slug);
  if (had !== undefined) return had;
  const row = v.parse(PaintedWorldSchema, input), { fog } = row;
  const grass = new GrassPresentationProfile(row.grass.rows,files,selected), bake = staticCaptureUniforms(row.capture), air = paintedAir(row.air);
  const fogLut = headingTexture({ samples: fog.lut, stride: 3, half: true, name: `${slug}-fog-lut` });
  const ramp = new ColourRampFog({ start: fog.start, end: fog.end, near: fog.haze, zenith: fog.haze, panorama: { lut: { value: fogLut },
    aerial: { value: v4Of(fog.aerial) }, edge: { value: v4Of(fog.edge) }, tint: panoramaTint } }).model(fog.order);
  const cards = row.grass.cards, world = row.world, grade: Record<string, IUniform<number>> = world === undefined ? {} : uniformsFrom(world.grade.uniforms);
  const wire = (ports: PaintedWorldPorts): Promise<PainterlyWorld | null> => {
    if (world === undefined) return Promise.resolve(null);
    lendUniforms(ports.scope, world.grade.lend, grade);
    const saturation = grade[world.grade.saturation];
    if (saturation === undefined) throw new Error(`Painted world grade has no ${world.grade.saturation}`);
    const uniforms = { ...Object.fromEntries(Object.entries(grade).filter(([name]) => name !== world.grade.saturation)),
      ...Object.fromEntries(Object.entries(world.tint).map(([name, part]) => [name, panoramaTint[part]])) };
    const { renderer, scene, scope, sky, groups, casters, daySaturation } = ports;
    return PainterlyWorld.build(world.rows, { renderer, scene, scope, sky, groups, casters,
      get stars() { return ports.stars; }, grass, capture: { rows: row.capture, uniforms: bake },
      panorama: { rows: world.panorama, ridge: world.ridge, lut: fogLut, uniforms }, key: { rows: world.key, daySaturation, saturation } });
  };
  const parts: PaintedWorldParts = { bake, fogLut, tint: panoramaTint, grass, wire, look: {
    // the cloud shadows first, then the panorama fog: every fogged material fades into the painted haze behind it
    fog: { ...ramp, install: () => { air.install(); ramp.install(); } },
    terrainPainter: paintedGroundPainter(slug, row.ground, row.tiles, bake),
    grass: { build: (sky, forest) => new GrassPresentation(grass, sky, forest, bake, cards).build(), prepare: () => grass.prepare() },
    sky: air.sky,
  } };
  paintedWorlds.set(slug, parts);
  return parts;
}

/** The painted world the level `slug`'s look built; throws before it has. */
export function paintedWorldOf(slug: string): PaintedWorldParts {
  const parts = paintedWorlds.get(slug);
  if (parts === undefined) throw new Error(`No painted world for ${slug}: its look builds it before its world wiring`);
  return parts;
}

function v4Of(row: readonly [number, number, number, number]): Vector4 { return new Vector4(...row); }
