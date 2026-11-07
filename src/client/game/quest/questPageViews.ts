import { QuestRuntimeDocumentSchema, QuestRuntimeFileSchema } from '@wildshard/format/questRuntime';
/**
 * A quest page's per-frame views (G571, client-only presentation) over the owners the entered quest lends: the chapter
 * lead and the quest spawns stepped with their declared puff domes (a dome swells where each cue fired), a living
 * building's speed driven by a quest flag (the mill wheel), a throttled spine projection near a declared scene's
 * middle (the hollow's secret), and an achievement when the page's compendium has every entry seen or taken. Rows
 * only: the story file's view rows (`page`, `ranged`, `quest`, `spawns`, `content`, `wheel`, `secret`, `journal`, `pool`).
 * The `pool` row draws a lowering water surface and its companion (the dam's trickle) from the world scenes: a quest
 * flag lowers it, its level reaches its look and the declared water body, the companion fades in across the travel.
 * The views chain after the runtime's world update for their scope, and retire with it.
 * The PERF LAP's teleports step no lead and no spawns and project nothing.
 */
import * as THREE from 'three';
import * as v from 'valibot';
import type { Flags } from '@wildshard/engine/world/interact/flags';
import { perfLap } from '@wildshard/engine/core/perfLap';
import { DomePuffs } from '@wildshard/engine/fx/groundFx';
import type { ShardContext } from '../plugin/context';
import type { QuestPageComposition } from './pageComposition';
import { entryOwner } from '../../../shared/game/shardfile/entryOwners';
import { installChapterLead, type QuestSpawnResult } from './chapterDirector';
import { forestPage, type ForestPage } from '../shardfile/forestPage';
import { rangedPage } from '../loadout/rangedPage';
import { setLiveWaterLevel } from '@wildshard/engine/world/water/declared';
import { WaterSurface } from '../systems/looks/waterSurface';
import { parseWaterSurface } from '@wildshard/format/water';
import { installWorldScenes } from '../shardfile/worldScenes';
import { residentWorldScope } from '../shardfile/hybridPresentation';
import { lentLook, setLentParam } from '../shardfile/lentLooks';

const id = v.pipe(v.string(), v.minLength(1), v.maxLength(128)), n = v.pipe(v.number(), v.finite());
export const QuestPageViewsSchema: v.GenericSchema<BoundedQuestPageViewsInput, BoundedQuestPageViews> = v.looseObject({
  page: id, ranged: id, quest: id, spawns: id, content: QuestRuntimeFileSchema,
  wheel: v.looseObject({ flag: id, speed: n }),
  secret: v.looseObject({ scene: id, projection: id, floorY: n, mid: v.tuple([n, n, n]) }),
  journal: v.strictObject({ event: id }),
  pool: v.strictObject({ name: id, flag: id, water: id, still: v.strictObject({ scene: id, surface: v.unknown() }), trickle: v.strictObject({ scene: id, surface: v.unknown() }),
    level: v.strictObject({ look: id, param: id }), fade: v.strictObject({ look: id, param: id }) }),
});
export type QuestPageViewRows = v.InferOutput<typeof QuestPageViewsSchema>;

interface Owners {
  readonly rows: QuestPageViewRows; readonly flags: Flags; readonly floor: ForestPage; readonly player: THREE.Vector3;
  readonly spine: NonNullable<QuestPageComposition['spine']>; readonly facets: QuestPageComposition['facets'];
  readonly journal: () => ReturnType<typeof rangedPage>['compendium'];
  readonly lead: ReturnType<typeof installChapterLead>; readonly spawns: QuestSpawnResult;
  readonly leadPuffs: DomePuffs; readonly spawnPuffs: DomePuffs; readonly hollow: { at: THREE.Vector3 | null };
  readonly still: WaterSurface; readonly trickle: THREE.Mesh;
}
const _v = new THREE.Vector3();
export class QuestPageViews {
  private slowT = 0;
  private readonly o: Owners;
  private constructor(owners: Owners) { this.o = owners; }
  /** the entered quest's flags (the shard's own flag-driven views read them) */
  get flags(): Flags { return this.o.flags; }

  static async install(ctx: ShardContext, input: unknown): Promise<QuestPageViews> {
    const rows = v.parse(QuestPageViewsSchema, input), quest = entryOwner(ctx.scope, 'quest', rows.quest), { flags, facets, spine } = quest;
    const shell = ctx.game.runtime, world = shell?.world;
    if (shell === undefined || world === undefined || world === null || spine === null) throw new Error('Missing quest view world');
    const floor = forestPage(ctx.scope, rows.page), equipment = rangedPage(ctx.scope, rows.ranged);
    const spawns = entryOwner(ctx.scope, 'quest-spawns', rows.spawns), product = ctx.product;
    const left = (): boolean => ctx.scope.disposed || ctx.scope.disposing || ctx.product !== product
      || ctx.game.runtime !== shell || shell.world !== world;
    const content = v.parse(QuestRuntimeDocumentSchema, await product.json<unknown>(rows.content));
    if (left()) throw new Error('Quest page views left during runtime admission');
    if (entryOwner(ctx.scope, 'quest', rows.quest) !== quest || entryOwner(ctx.scope, 'quest-spawns', rows.spawns) !== spawns
      || forestPage(ctx.scope, rows.page) !== floor || rangedPage(ctx.scope, rows.ranged) !== equipment)
      throw new Error('Quest page view loans changed during runtime admission');
    const lead = installChapterLead(ctx, content);
    const leadPuffs = ctx.scope.own(new DomePuffs(world.game.scene, new THREE.Color(...lead.puffs.color), lead.puffs.count));
    const spawnPuffs = ctx.scope.own(new DomePuffs(world.game.scene, new THREE.Color(...spawns.puffs.color), spawns.puffs.count));
    const hollow: Owners['hollow'] = { at: null };
    // the secret's scene settles later: a page that left meanwhile keeps no projection point
    void floor.cabins.resources.place(rows.secret.scene).then(() => { if (!left()) hollow.at = new THREE.Vector3().fromArray(rows.secret.mid); return hollow; });
    // the lowering pool and its companion: the world scenes' published meshes, drawn in their lent looks
    const scenes = await installWorldScenes(ctx, ctx.product.section('world/scenes'), residentWorldScope(ctx)), p = rows.pool;
    // a page that left during the scene install draws, chains and publishes nothing
    if (left()) throw new Error('Quest page views left during their scene install');
    const draw = (row: { readonly scene: string; readonly surface: unknown }): WaterSurface =>
      new WaterSurface(row.surface, { material: lentLook(parseWaterSurface(row.surface).look) }).draw(scenes.mesh(row.scene).geometry.clone());
    const still = draw(p.still), trickle = draw(p.trickle).mesh, group = new THREE.Group();
    group.name = p.name; group.add(still.mesh, trickle); world.game.scene.add(group);
    const views = new QuestPageViews({ rows, flags, floor, player: world.player.position, spine, facets, journal: () => equipment.compendium,
      lead, spawns, leadPuffs, spawnPuffs, hollow, still, trickle });
    still.setLowered(flags.has(p.flag), true); views.publish();
    const previous = shell.hooks.worldUpdate, update = (dt: number, t: number): void => { previous?.(dt, t); views.present(dt, t); };
    shell.hooks.worldUpdate = update;
    ctx.scope.onDispose(() => {
      group.removeFromParent();
      if (shell.hooks.worldUpdate === update) { if (previous === undefined) delete shell.hooks.worldUpdate; else shell.hooks.worldUpdate = previous; }
    });
    return views;
  }

  /** the pool's level to its look and the declared water body; the companion's fade and visibility */
  private publish(): void {
    const { rows: { pool }, still, trickle } = this.o;
    setLentParam(pool.level.look, pool.level.param, still.level); setLiveWaterLevel(pool.water, still.level);
    setLentParam(pool.fade.look, pool.fade.param, still.reveal); trickle.visible = still.reveal > 0.001;
  }

  present(dt: number, t: number): void {
    const { rows, flags, floor, spine, facets, player, lead, spawns, leadPuffs, spawnPuffs, hollow, still } = this.o;
    still.setLowered(flags.has(rows.pool.flag)); still.update(dt); this.publish();
    floor.cabins.life.wheelSpeed = flags.has(rows.wheel.flag) ? rows.wheel.speed : 0;
    if (!perfLap.active) { // E350 F-J1: the PERF LAP's teleports call no lead and no spawns, and project no secret
      lead.update(dt, t); spawns.update(dt, player); leadPuffs.update(dt, t); spawnPuffs.update(dt, t);
      for (const puff of lead.takePuffs()) leadPuffs.burst(_v.set(puff.x, puff.y + lead.puffs.height, puff.z), ...lead.puffs[puff.kind]);
      for (const puff of spawns.takePuffs()) spawnPuffs.burst(_v.set(puff.x, puff.y + spawns.puffs.height, puff.z), ...spawns.puffs.burst);
    }
    if (t - this.slowT <= 0.5) return;
    this.slowT = t;
    if (!perfLap.active && hollow.at !== null) spine.project(rows.secret.projection, { playerX: player.x, playerY: player.y, playerZ: player.z,
      atX: hollow.at.x, atY: hollow.at.y, atZ: hollow.at.z, floorY: rows.secret.floorY });
    const st = this.o.journal()?.state;
    if (st?.def.entries.every((e) => { const s = st.stats(e.id).state; return s === 'seen' || s === 'taken'; }) === true) facets.achievements?.event(rows.journal.event, 1);
  }
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedQuestPageViewsInput = BoundedQuestPageViews;
type BoundedQuestPageViews = {
    page: string;
    ranged: string;
    quest: string;
    spawns: string;
    content: v.InferOutput<typeof QuestRuntimeFileSchema>;
    wheel: {
        flag: string;
        speed: number;
    } & Record<string, unknown>;
    secret: {
        scene: string;
        projection: string;
        floorY: number;
        mid: [
            number,
            number,
            number
        ];
    } & Record<string, unknown>;
    journal: {
        event: string;
    };
    pool: {
        name: string;
        flag: string;
        water: string;
        still: {
            scene: string;
            surface: unknown;
        };
        trickle: {
            scene: string;
            surface: unknown;
        };
        level: {
            look: string;
            param: string;
        };
        fade: {
            look: string;
            param: string;
        };
    };
} & Record<string, unknown>;
