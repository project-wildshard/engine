/**
 * A quest page's placed kit figures (G571, `quest.composition` `figures.file`), installed by the composition host after
 * its one prepare and before install. Each row builds the original `KitFigure` from its admitted kit and catalogue
 * rows: the part geometry copied from the page's fixed-draw owner, its extra objects (an unlit flame mesh; a building
 * cloud that stays hidden on an empty draw until both its geometry and its lent look exist, never owning that look),
 * its publications, placed at its composition place and turned to its yaw. The camp part (campAt 'fire') and an
 * object at 'fire' sit at the fire turned into the figure's frame (the inverse yaw of fire - feet, height included),
 * exactly as Driftwood's castaway camp did. A trader row's piece, card and counter stay with the composition's
 * placed-model owners (installQuestFigures). Systems run in row order; the page scope disposes every figure.
 */
import * as THREE from 'three';
import * as v from 'valibot';
import type { ColliderDesc, WorldRegistry } from '@wildshard/engine/world/registry';
import { terrainHeight } from '@wildshard/engine/world/terrainHeight';
import { TIER } from '@wildshard/engine/core/tier';
import { FigureRowSchema } from '@wildshard/format/figures';
import { installChannelPrograms } from '../../../shared/game/plugin/channelPrograms';
import { atlasFigureSkin, productSkinUrl } from '../systems/npc/figureSkins';
import { QuestFiguresSchema, type QuestFigureRows, type QuestFiguresRows } from '@wildshard/format/questFigures';
import type { Scope } from '@wildshard/engine/app/scope';
import { ownSceneResource } from '@wildshard/engine/app/sceneOwnership';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { KitFigure } from '../systems/npc/kitFigure';
import { createBuildingCloud } from '../shardfile/buildingCloud';
import { SceneHandles } from '../shardfile/sceneHandles';
import { hasLentLook, lentLook } from '../shardfile/lentLooks';
import { defineModel, sharedModelContext, type ModelDef } from '@wildshard/engine/models/model';
import { place as placeModel } from '@wildshard/engine/models/place';
import type { ShardContext } from '../plugin/context';
import { FigureRows } from '../systems/npc/figureRows';
import { stepFigureOrbit } from './figureOrbit';
import { ownQuestTree } from './chapterView';

interface Place { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }
/** What the composition host lends the installer: its one placement, the page's scene resources, the fixed-draw owner,
 *  the admitted figure catalogue and the product's client channels (the figures' attention programs). */
export interface QuestFigurePorts {
  readonly sky: SkyRig;
  readonly scope?: Scope;
  readonly resources: SceneHandles;
  readonly place: (at: QuestFigureRows['feet']) => Place;
  readonly draws: { readonly ready: boolean; handle: (slot: string) => { copy: () => THREE.BufferGeometry } };
  readonly catalogue: { rows: (id: string) => unknown; kit: (id: string) => unknown };
  readonly channels: unknown;
}

/** The fire's place in the figure's frame: `fire - feet` turned by the figure's inverse yaw, its height difference kept. */
export function fireInFigureFrame(feet: Place, fire: { readonly x: number; readonly y: number; readonly z: number }): THREE.Vector3 {
  const dx = fire.x - feet.x, dz = fire.z - feet.z, c = Math.cos(-feet.yaw), s = Math.sin(-feet.yaw);
  return new THREE.Vector3(dx * c + dz * s, fire.y - feet.y, -dx * s + dz * c);
}

/** One figure from its row at its places (the castaway's camp and the trader's stall alike). */
export function questFigure(row: QuestFigureRows, ports: QuestFigurePorts): KitFigure {
  const feet = ports.place(row.feet), yaw = feet.yaw, fire = row.fire === undefined ? feet : ports.place(row.fire);
  const local = fireInFigureFrame(feet, fire);
  const offset = (at: 'feet' | 'fire'): THREE.Vector3 => at === 'fire' ? local : new THREE.Vector3();
  const geometry = new Map(Object.entries(row.parts).map(([part, slot]) => {
    const g = ports.draws.handle(slot).copy(); if (part === 'camp' && row.campAt === 'fire') g.translate(local.x, local.y, local.z); return [part, g];
  }));
  const objects = new Map<string, THREE.Object3D>();
  for (const object of row.objects) {
    const o = offset(object.at);
    if (object.kind === 'basic-mesh') {
      const material = new THREE.MeshBasicMaterial({ vertexColors: object.vertexColors, color: new THREE.Color(...object.colour) });
      if (ports.scope !== undefined) ownSceneResource(material, ports.scope);
      material.name = object.name;
      const mesh = new THREE.Mesh(ports.draws.handle(object.draw).copy(), material);
      mesh.position.set(o.x, o.y + object.lift, o.z); objects.set(object.id, mesh);
    } else {
      const ready = ports.draws.ready, lit = hasLentLook(object.look);
      const cloud = createBuildingCloud(ports.resources, {
        geometry: ports.resources.lend(ready ? ports.draws.handle(object.draw).copy() : new THREE.BufferGeometry()),
        material: lit ? ports.resources.lend(lentLook(object.look)) : null, seeds: object.seeds, name: object.name,
        at: [o.x, o.y, o.z], center: object.center, radius: object.radius, order: object.order, visible: lit && ready });
      if (ports.scope !== undefined) {
        ownSceneResource(cloud.geometry, ports.scope);
        if (!lit) for (const material of Array.isArray(cloud.material) ? cloud.material : [cloud.material]) ownSceneResource(material, ports.scope);
      }
      objects.set(object.id, cloud);
    }
  }
  for (const publication of row.publish) ports.resources.publish(publication.id, ports.draws.handle(publication.draw).copy());
  const figure = new KitFigure(ports.sky, row.kit, ports.catalogue.rows(row.kit), ports.catalogue.kit(row.kit),
    { geometry, objects, channels: ports.channels }, ports.resources, ports.scope);
  figure.group.position.set(feet.x, feet.y, feet.z); figure.group.rotation.y = yaw;
  return figure;
}

/** What a page lends installQuestFigures: its prepared placement (places and floor), scene resources, fixed draws and
 *  figure catalogue, and the catalogue whose models a trader row names (its card and counter). */
export interface QuestFigureInstall extends Pick<QuestFigurePorts, 'resources' | 'draws' | 'catalogue'> {
  readonly placement: { place: QuestFigurePorts['place']; floorAt: (x: number, z: number) => number };
  readonly models: { model: (name: string) => ModelDef<Record<string, unknown>> };
}

/** Install the admitted figures file on the page: each figure live in the page scope, a trader row placed as its registry
 *  piece (its card the Explorer specimen, its catalogue rows' colliders) with its counter `ahead` metres in front of its
 *  feet on the floor, each figure posed by its row's system before that row's systems. */
export function installQuestFigures(ctx: ShardContext, input: unknown, ports: QuestFigureInstall): readonly KitFigure[];
export function installQuestFigures(ctx: ShardContext, input: unknown): QuestFigureGroup;
export function installQuestFigures(ctx: ShardContext, input: unknown, ports?: QuestFigureInstall): readonly KitFigure[] | QuestFigureGroup;
export function installQuestFigures(ctx: ShardContext, input: unknown, ports?: QuestFigureInstall): readonly KitFigure[] | QuestFigureGroup {
  const parsed = v.parse(QuestFiguresSchema, input), rows = parsed.figures, world = ctx.game.runtime?.world;
  if (world === undefined || world === null || ctx.scope.disposed || ctx.scope.disposing) throw new Error('Quest figures require their entered world');
  // A merged group stands alone and needs none of the kit figures' ports; both checks precede any allocation.
  if (ports === undefined) {
    if (parsed.group === undefined) throw new Error('Quest kit figures require their placement, draws and catalogue ports');
    return figureGroup({ scope: ctx.scope, sky: world.sky, registry: world.registry, channels: ctx.product.shardfile.clientChannels, skinUrl: productSkinUrl(ctx.product) }, parsed.group);
  }
  if (parsed.group !== undefined) throw new Error('A merged quest figure group installs without kit figure ports');
  // Check all placed-model descriptors before the first figure is constructed.
  const models = new Map(rows.flatMap(row => {
    const placed = row.card !== undefined || row.piece !== undefined || row.name !== undefined || row.counter !== undefined;
    if (!placed) return [];
    if (row.card === undefined || row.piece === undefined || row.name === undefined || row.counter === undefined || row.fire !== undefined)
      throw new Error('Placed quest figure requires its card, piece, name and counter');
    return [[row.id, { card: ports.models.model(row.card), counter: ports.models.model(row.counter.model) }] as const];
  }));
  const common: QuestFigurePorts = { ...ports, place: at => ports.placement.place(at), sky: world.sky, scope: ctx.scope, channels: ctx.product.shardfile.clientChannels };
  const figures: { readonly row: QuestFigureRows; readonly figure: KitFigure }[] = [];
  // Keep the original cleanup order (speaker then trader). FigureRows owns
  // publications; borrowed looks stay borrowed.
  const dispose = (): void => { for (const { figure } of figures) figure.dispose(); };
  try { ctx.scope.run(() => {
    for (const row of rows) {
      const cards = models.get(row.id);
      if (cards === undefined) { figures.push({ row, figure: questFigure(row, common) }); continue; }
      const counterRow = row.counter;
      if (counterRow === undefined || row.piece === undefined || row.name === undefined) throw new Error('Missing admitted figure placement');
      const byGroup = new WeakMap<THREE.Object3D, KitFigure>();
      const model = defineModel({ ...cards.card, specimen: cards.card.build,
        build: () => {
          // placeModel applies feet once. The original trader builder is at its
          // origin and uses its own publication namespace, unlike the speaker.
          const figure = questFigure(row, { ...common, resources: new SceneHandles(world.sky), place: () => ({ x: 0, y: 0, z: 0, yaw: 0 }) });
          byGroup.set(figure.group, figure); return figure.group;
        }, colliders: () => FigureRows.collidersFor(ports.catalogue.rows(row.kit)) });
      const feet = ports.placement.place(row.feet), context = { ...sharedModelContext(world.sky), specimenScope: ctx.scope };
      const placed = placeModel(model, [feet], { ctx: context, draw: 'single', registry: world.registry, piece: { id: row.piece, name: row.name } });
      const figure = byGroup.get(placed.object);
      if (figure === undefined) throw new Error('Missing entered quest figure');
      figures.push({ row, figure });
      const x = feet.x + Math.sin(feet.yaw) * counterRow.ahead, z = feet.z + Math.cos(feet.yaw) * counterRow.ahead;
      const counter = placeModel(cards.counter, [{ x, y: ports.placement.floorAt(x, z), z, yaw: feet.yaw }],
        { ctx: context, draw: 'single', registry: world.registry, piece: { id: counterRow.piece, name: counterRow.name, solidFloor: counterRow.solidFloor } });
      ownQuestTree(placed.object, ctx.scope); ownQuestTree(counter.object, ctx.scope);
      figure.companions.push(counter.object);
    }
  }); } catch (error) { dispose(); throw error; }
  ctx.scope.onDispose(dispose);
  for (const { row, figure } of figures) ctx.system({ id: row.system.id, phase: 'update', before: [...row.system.before],
    run: (dt, time) => { figure.update(dt, time, world.player.position); } });
  return figures.map(({ figure }) => figure);
}

type FigureGroupRows = NonNullable<QuestFiguresRows['group']>;

/** One group figure's live pose: the fields its channel programs read and write (owner `person`). */
interface FigureGroupMember {
  feet: THREE.Vector3; headWorld: THREE.Vector3; talking: boolean; yaw: number; idleYaw: number;
  headYaw: number; headPitch: number; armX: number; armZ: number; glanceT: number; glance: number; phase: number; ring: number;
}
/** A merged figure group's live view (format/figures.ts `FigureGroupSchema`). */
export interface QuestFigureGroup {
  readonly ready: Promise<void>;
  readonly group: THREE.Group;
  readonly figures: ReadonlyMap<string, FigureGroupMember>;
  update: (dt: number, t: number, player: THREE.Vector3) => void;
}

/** The body (a breath of vertical scale), head and arm matrices from a member's pose; matrices reused. */
function memberPose(): (p: FigureGroupMember, neck: THREE.Vector3, write: (body: THREE.Matrix4, head: THREE.Matrix4, arm: THREE.Matrix4) => void, pivots: { neck: THREE.Vector3; shoulder: THREE.Vector3 }) => void {
  const body = new THREE.Matrix4(), head = new THREE.Matrix4(), arm = new THREE.Matrix4();
  const q = new THREE.Quaternion(), hq = new THREE.Quaternion(), aq = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3();
  return (p, neck, write, pivots) => {
    body.compose(p.feet, q.setFromEuler(e.set(0, p.yaw, 0)), s.set(1, 1 + Math.sin(p.phase * 1.3) * 0.012, 1));
    hq.setFromEuler(e.set(p.headPitch, p.headYaw, 0, 'YXZ'));
    aq.setFromEuler(e.set(p.armX, 0, p.armZ));
    s.set(1, 1, 1);
    head.compose(pivots.neck, hq, s).premultiply(body);
    arm.compose(pivots.shoulder, aq, s).premultiply(body);
    write(body, head, arm);
    p.headWorld.copy(neck).applyMatrix4(body); p.headWorld.y += 0.12;
  };
}

/**
 * A merged figure group (a quest page's `group` row): every figure is a FigureRows over the root, head and arm joints this group publishes,
 * walked along its orbit, moved by its admitted channel programs (the head, face and arm, group = the figure id) and
 * posed once a frame, all drawn as one atlas skin (`atlasFigureSkin`). The still figures' colliders register as one
 * piece, each moving figure's as its own; the floor is the terrain or a registered deck just above it. The group sleeps
 * beyond `sleep.distance` of `sleep.figure`.
 */
function figureGroup(w: { scope: Scope; sky: SkyRig; registry: WorldRegistry; channels: unknown; skinUrl: (url: string) => string }, rows: FigureGroupRows): QuestFigureGroup {
  const atlas = rows.atlas[TIER], scope = w.scope;
  const group = new THREE.Group(), resources = new SceneHandles(w.sky);
  group.name = rows.name;
  const floorAt = (x: number, z: number): number => { const y = terrainHeight(x, z), deck = w.registry.floorAt(x, z); return deck !== undefined && deck > y && deck < y + 2 ? deck : y; };
  const bones = atlas.joints.map(name => {
    const bone = new THREE.Bone(); bone.name = name; bone.matrixAutoUpdate = false; bone.matrixWorldAutoUpdate = false;
    group.add(bone);
    resources.publish(name.toLowerCase(), bone); return bone;
  });
  const figures = new Map<string, FigureGroupMember>(), still: ColliderDesc[] = [], pose = memberPose();
  const views = Object.entries(rows.figures).map(([id, spec]) => {
    const row = v.parse(FigureRowSchema, spec.row), feet = new THREE.Vector3(...row.feet); feet.y = floorAt(feet.x, feet.z);
    const view = new FigureRows(resources, { ...row, feet: feet.toArray() }, scope);
    const neck = new THREE.Vector3(...spec.frame.neck);
    const p: FigureGroupMember = { feet, headWorld: view.talkPoint, get talking() { return view.talking; }, set talking(value: boolean) { view.talking = value; },
      yaw: row.yaw, idleYaw: row.yaw, headYaw: 0, headPitch: 0, armX: 0, armZ: 0, glanceT: spec.glanceAfter, glance: 0, phase: spec.phase, ring: 0 };
    figures.set(id, p);
    const root = resources.object(`${row.id}.joint.root`), head = resources.object(`${row.id}.joint.head`), arm = resources.object(`${row.id}.joint.arm`);
    head.position.copy(neck); arm.position.fromArray(spec.frame.shoulder);
    const pivots = { neck: head.position, shoulder: arm.position };
    const write = (): void => {
      group.updateWorldMatrix(true, false);
      pose(p, neck, (body, h, a) => {
        root.matrixWorld.multiplyMatrices(group.matrixWorld, body);
        head.matrixWorld.multiplyMatrices(group.matrixWorld, h);
        arm.matrixWorld.multiplyMatrices(group.matrixWorld, a);
      }, pivots);
    };
    const anchor = new THREE.Object3D();
    if (spec.moving) {
      anchor.name = rows.pieces.moving.id; anchor.position.copy(feet); anchor.updateMatrixWorld(true); group.add(anchor);
      w.registry.add({ ...rows.pieces.moving, colliders: view.colliders.map(collider => ({ ...collider, surface: 'flesh' as const })), follows: anchor });
    } else for (const collider of view.colliders) {
      if (!('x' in collider)) throw new Error('Figure collider requires a local pose');
      still.push({ ...collider, surface: 'flesh', x: feet.x, y: feet.y + collider.y, z: feet.z });
    }
    const motion = installChannelPrograms(w.channels, id, new Map([['person', p]])), orbit = spec.motion.orbit;
    write();
    return { write, update: (dt: number, t: number, player: THREE.Vector3): void => {
      p.phase += dt;
      const dx = player.x - feet.x, dz = player.z - feet.z, distance = Math.hypot(dx, dz), toYou = Math.atan2(dx, dz);
      // the walk round the ring is figureOrbit.ts (the Node simulation steps the same numbers); the moving piece follows
      if (orbit !== undefined && stepFigureOrbit(orbit, p, feet, dt, distance, floorAt)) { anchor.position.copy(feet); anchor.updateMatrixWorld(true); }
      motion.evaluate({ time: t, delta: dt, values: { distance, toYou, talk: Number(p.talking), playerY: player.y,
        decayFace: 1 - Math.exp(-(p.talking ? 5 : 2.5) * dt), decay4: 1 - Math.exp(-4 * dt), decay6: 1 - Math.exp(-6 * dt) } });
      write();
    } };
  });
  const sleeper = figures.get(rows.sleep.figure);
  if (sleeper === undefined) throw new Error(`Missing sleeping figure: ${rows.sleep.figure}`);
  w.registry.add({ ...rows.pieces.still, object: group, colliders: still });
  const ready = atlasFigureSkin(atlas, w.sky, scope, w.skinUrl).then(mesh => {
    for (const [i, bone] of bones.entries()) {
      const prepared = mesh.skeleton.bones[i]; if (prepared === undefined) throw new Error('Missing prepared pivot');
      bone.position.copy(prepared.position);
    }
    mesh.skeleton.bones = bones;
    for (const view of views) view.write();
    group.add(mesh); return undefined;
  });
  return { group, figures, ready, update: (dt, t, player) => {
    if (Math.hypot(player.x - sleeper.feet.x, player.z - sleeper.feet.z) <= rows.sleep.distance) for (const view of views) view.update(dt, t, player);
  } };
}
