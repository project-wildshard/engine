import { BatchedMesh, Vector3, type Mesh, type Object3D } from 'three';
import { InteractSfx } from '@wildshard/engine/audio/interactSfx';
import { DeclaredAmbience } from '@wildshard/engine/audio/declaredAmbience';
import { withOwner } from '@wildshard/engine/app/ownership';
import { app } from '@wildshard/engine/app/runtime';
import { ownSceneTree, sceneObjectOwner } from '@wildshard/engine/app/sceneOwnership';
import type { Scope } from '@wildshard/engine/app/scope';
import { WORK_SLICE_MS, workSlice, buildYield } from '@wildshard/engine/core/workSlice';
import { cableModes } from '@wildshard/engine/player/modes';
import { wirePage } from '../shardfile/wirePage';
import type { Placed } from '@wildshard/engine/models/place';
import type { LiveMarker } from '@wildshard/engine/quest/view';
import type { Flags } from '@wildshard/engine/world/interact/flags';
import type { Interactables } from '@wildshard/engine/world/interact/Interactables';
import type { InteractTable, createQuestPlacements } from '@wildshard/engine/world/interact/types';
import type { QuestPageTalksRows } from '@wildshard/format/npcs';
import { completionProjection, type CompletionProgress } from '../complete/declared';
import { ProductFigureCatalogue } from '../models/figureCatalogue';
import type { ShardContext } from '../plugin/context';
import { QuestViews, type QuestNpcTalkPorts } from '../plugin/ui';
import { ControlRefinement } from '../shardfile/controlRefinement';
import { residentWorldScope } from '../shardfile/hybridPresentation';
import { SceneHandles } from '../shardfile/sceneHandles';
import { StreamingCamera } from '../shardfile/streamingView';
import { installWorldScenes } from '../shardfile/worldScenes';
import { FigureRows } from '../systems/npc/figureRows';
import { installContractBoardPage } from './contractBoardPage';

// P1-E4.6: what a chapter draws. chapter.ts holds its rows, flags and bindings; this holds its scene, figures, sound and
// map. Nothing here imports a server file: the sim half calls in with the state it decided.
type Entered = NonNullable<NonNullable<ShardContext['game']['runtime']>['world']>;
type Runtime = NonNullable<ShardContext['game']['runtime']>;
type Play = NonNullable<Runtime['play']>;
interface Point { readonly x: number; readonly y: number; readonly z: number }
interface CableSound { readonly at: string | Point; readonly sound: 'lever' | 'plate' }
/** A cable's admitted rows. */
export interface QuestCableRows {
  readonly mode: string; readonly carriage: string; readonly scene: { readonly kind: 'placement' | 'object'; readonly id: string };
  readonly prompt: string | Point; readonly radius: number; readonly label: string; readonly camera: boolean;
  readonly feedback?: { readonly weapons: 'visible' | 'enabled'; readonly start: CableSound; readonly end: CableSound; readonly arrival?: string;
    readonly shot?: { readonly audio: string; readonly family: string; readonly at: string | Point } };
}
type TalkFigure = QuestNpcTalkPorts<FigureRows>['figures'] extends ReadonlyMap<string, infer Model> ? Model : never;

/** Respect a piece's owner when a quest borrows it; own only the entry's unowned subtree. */
export function ownQuestTree(object: Object3D, scope: Scope): void {
  const mine = sceneObjectOwner(object);
  if (mine !== null && mine !== (object.parent === null ? null : sceneObjectOwner(object.parent))) return;
  ownSceneTree(object, scope, app.assets);
}
/** Client cable view borrows the existing scene and mode continuation. */
export interface QuestCableView {
  readonly group: Object3D; readonly placed: Placed | null; readonly trolley: Mesh;
  readonly prompt: ReturnType<ReturnType<typeof cableModes>['bindView']>;
  readonly cables: ReturnType<typeof cableModes>; readonly mode: string;
  /** Advance the original mode and drain its feedback once at the caller's phase. */
  readonly update: (dt: number) => void;
}
/** The cable's carriage, prompt, sound and arrival notice over its admitted rows. */
export async function installQuestCableView(ctx: ShardContext, cable: QuestCableRows, world: Entered): Promise<QuestCableView> {
  const runtime = ctx.game.runtime;
  if (runtime === undefined) throw new Error('Quest cable requires its entered world');
  const requireLive = (): void => { if (ctx.scope.disposed) throw new Error('Quest cable left during scene admission'); };
  requireLive();
  const cables = cableModes(ctx.scope); cables.state(cable.mode);
  const scenes = await installWorldScenes(ctx, ctx.product.section('world/scenes'), residentWorldScope(ctx));
  const placed = cable.scene.kind === 'placement' ? await scenes.place(cable.scene.id) : null;
  requireLive();
  const feedback = cable.feedback, play = runtime.play;
  if (feedback !== undefined && play === null) throw new Error('Cable feedback requires its entered play owners');
  const audio = feedback?.shot === undefined ? null : runtime.objects[feedback.shot.audio];
  if (feedback?.shot !== undefined && (!(audio instanceof DeclaredAmbience) || !audio.sfx.acceptsShot(feedback.shot.family))) throw new Error('Cable feedback requires its declared sound bank');
  const at = (value: string | Point): Vector3 => typeof value === 'string' ? scenes.vector(value) : new Vector3(value.x, value.y, value.z);
  const start = feedback === undefined ? null : at(feedback.start.at), end = feedback === undefined ? null : at(feedback.end.at);
  const shotAt = feedback?.shot === undefined ? null : at(feedback.shot.at), sfx = play === null ? null : new InteractSfx(play.audio);
  const group = placed?.object ?? scenes.object(cable.scene.id), trolley = scenes.mesh(cable.carriage);
  const position = typeof cable.prompt === 'string' ? scenes.vector(cable.prompt) : new Vector3(cable.prompt.x, cable.prompt.y, cable.prompt.z);
  const prompt = cables.bindView(cable.mode, trolley, world.player, { position, radius: cable.radius, label: cable.label }, cable.camera ? world.game.camera : undefined);
  world.game.scene.add(group); runtime.interactables.push(prompt);
  // On a server the press asks by the cable's mode, and the ride is the server's: this page draws where it carries the body.
  cables.serve(cable.mode); prompt.wireId = cable.mode;
  return { group, placed, trolley, prompt, cables, mode: cable.mode, update: () => {
    if (ctx.scope.disposed) return;
    cables.follow(cable.mode, wirePage.led(), world.player.position);
    if (feedback === undefined || play === null || sfx === null) return;
    for (const on of cables.takeTransitions(cable.mode)) {
      play.weapons.visible = !on;
      if (feedback.weapons === 'enabled') play.weapons.setEnabled(!on);
      if (on && audio instanceof DeclaredAmbience && feedback.shot !== undefined && shotAt !== null) audio.sfx.shot(feedback.shot.family, { at: shotAt });
      sfx.interact(on ? feedback.start.sound : feedback.end.sound, (on ? start : end) ?? undefined);
      if (!on && feedback.arrival !== undefined) play.hud.toast(feedback.arrival);
    }
  } };
}
/** The story's speaking figures: catalogue models or borrowed rows, each with its bark and skin queue. */
export async function questTalkFigures(ctx: ShardContext, rows: QuestPageTalksRows, world: Entered, runtime: Runtime, play: Play, requireLive: () => void): Promise<{ readonly figures: Map<string, TalkFigure>; readonly immediate: Promise<void>[] }> {
  let skinQueue: ControlRefinement | undefined;
  let skinSequence = 0;
  const immediate: Promise<void>[] = [];
  const figures = new Map<string, TalkFigure>();
  for (const row of rows.models) {
    if (row.source === 'catalogue') {
      const book = await ProductFigureCatalogue.fromProduct(ctx.product, row.library), audio = runtime.objects[row.bark.audio];
      requireLive();
      if (!(audio instanceof DeclaredAmbience)) throw new Error('Quest talk lost its figure or audio owner');
      const scene = new SceneHandles(world.sky);
      figures.set(row.id, { kind: 'posed', create: (at, yaw) => {
        const figure = book.create(row.id, scene, [at.x, at.y, at.z], yaw, ctx.scope, { viewer: world.player.position,
          later: (id, position, run) => {
            if (skinQueue === undefined) {
              const camera = new StreamingCamera(ctx.root, () => world.game.camera);
              skinQueue = new ControlRefinement(ctx.scope, world.game.levelScope, () => world.player.position, () => buildYield(ctx.scope), () => camera.read());
            }
            return skinQueue.add(`${id}:${String(skinSequence++)}`, position, run);
          } });
        if (!figure.skinDeferred) immediate.push(figure.ready);
        return figure;
      },
        bark: figure => { audio.sfx.bark(row.bark.group, figure.talkPoint); } });
    } else {
      const figure = FigureRows.entered(ctx.scope, row.id);
      figures.set(row.id, { kind: 'borrowed', create: () => figure,
        own: (value, register) => { ownQuestTree(value.group, ctx.scope); ctx.scope.run(register); },
        at: value => value.headWorld(new Vector3()), advance: value => { value.syncAnchors(); },
        open: () => { if (row.swap) play.audio.weaponSwap(); }, stow: on => { if (row.stow) play.weapons.stowed = on; },
        approach: { at: value => value.group.position, run: value => { value.signal(row.approach); } },
      });
    }
  }
  return { figures, immediate };
}
/** The page's quest view owner for this entry. */
export function questViews(ctx: ConstructorParameters<typeof QuestViews>[0]): QuestViews { return new QuestViews(ctx); }
/** A chapter's talking figures, by talk id. */
export function chapterTalkFigures(scope: Scope, talks: readonly { readonly id: string; readonly figure?: string | undefined }[]): Record<string, { readonly headWorld: FigureRows['talkPoint']; talking: boolean }> {
  return Object.fromEntries(talks.map(row => {
    const figure = FigureRows.entered(scope, row.figure ?? row.id);
    return [row.id, { headWorld: figure.talkPoint, get talking() { return figure.talking; }, set talking(value: boolean) { figure.talking = value; } }];
  }));
}
/** What is left of a finished story, as map markers. */
export function completionMarkers(complete: Parameters<typeof completionProjection>[0], flags: Flags, progress: CompletionProgress | undefined,
  anchors: ReadonlyMap<string, { readonly x: number; readonly z: number }> | undefined): LiveMarker[] {
  return completionProjection(complete, flags, progress, undefined, undefined, anchors).markers;
}
/** The contract board's page. */
export function questBoardPage(...input: Parameters<typeof installContractBoardPage>): ReturnType<typeof installContractBoardPage> { return installContractBoardPage(...input); }
/** Make the admitted rows' shapes and prompts, a slice at a time. */
export async function installInteractablesView(ctx: ShardContext, table: InteractTable, flags: Flags, world: Entered, runtime: Runtime,
  placement: Pick<ReturnType<typeof createQuestPlacements>, 'floorAt' | 'place'>): Promise<Interactables & { readonly sfx: InteractSfx }> {
  const { floorAt, place } = placement;
  const { Interactables } = await import('@wildshard/engine/world/interact/Interactables');
  if (ctx.scope.disposed) throw new Error('Quest left while admitting interactables');
  const before = new Set(world.game.scene.children);
  const kit = withOwner(ctx.scope, () => new Interactables({ scene: world.game.scene, sky: world.sky,
    player: world.player, flags, place, floorAt, prompts: runtime.interactables }));
  // the rows' shapes are made a slice at a time: all at once they were ~60 ms of Driftwood's play task at phone CPU
  const slice = workSlice(WORK_SLICE_MS, ctx.scope);
  for (const row of table.rows) { withOwner(ctx.scope, () => kit.addRows([row])); await slice.check(); }
  withOwner(ctx.scope, () => kit.finish());
  for (const node of world.game.scene.children) if (!before.has(node) && node instanceof BatchedMesh) ownQuestTree(node, ctx.scope);
  ctx.scope.onDispose(() => { kit.dispose({ batches: false }); });
  const audio = runtime.play?.audio; if (audio === undefined) throw new Error('Quest interactions require entered audio');
  return Object.assign(kit, { sfx: new InteractSfx(audio) });
}
