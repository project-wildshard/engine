import { Group, type Object3D } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { grappleGuard } from '../grapple/tool';
import type { Piece } from '@wildshard/engine/world/registry';
import { readColliderRows } from '@wildshard/engine/models/colliders';
import { floorAtRects } from '@wildshard/engine/physics/box';
import { cutTerrain } from '@wildshard/engine/physics/terrain';
import type { Physics } from '@wildshard/engine/physics/Physics';
import { parseWorldEntry, type WorldEntryRows, type WorldEntryStep } from '@wildshard/format/worldEntry';
import type { SceneHandles } from './sceneHandles';
import { lentLook } from './lentLooks';

/** What a world entry runs against: the admitted scene handles, the world root it attaches under, and the build's facts. */
export interface WorldEntryPorts {
  /** the admitted scene handles (absent: an entry that runs only `piece` rows on its root, after the world is built) */
  readonly scenes?: SceneHandles;
  readonly root: Object3D;
  /** The concrete entered owner; required for live tool-closed pieces. */
  readonly scope?: Scope;
  readonly tier: 'phone' | 'desktop';
  /** the world variant this build is (a deck ending, a standalone or grid entry); rows with another `when.variant` skip */
  readonly variant?: string;
  /** registers a `piece` row's piece (the world registry's add, or the level's own piece registration); required by them */
  readonly piece?: (piece: Piece) => void;
  /** the physics a `cut` row lowers the ground of; required by them */
  readonly physics?: Physics;
  /** refuses when the build's owner left: run before and after every row, so nothing more allocates once it retires */
  readonly fence?: () => void;
}

/**
 * A shard's declared world entry (format/worldEntry): its rows run block by block, in order, as the world build reaches
 * each block. Every `place` keeps its placement for the build to read by id, or restores a declared frozen graph (its
 * roots are already published, so it hangs where it was frozen); a `piece` registers through the build's `piece` port.
 * Users: Driftwood Isle, Nine Dragon Stack.
 */
export class WorldEntry {
  private readonly restored = new Set<string>();
  /** T3: the placements this build took by tile (the tile driver attaches their copies) */
  private readonly tiled = new Set<string>();
  private readonly ran = new Set<string>();
  private constructor(private readonly rows: WorldEntryRows, private readonly ports: WorldEntryPorts) {}

  /** Admit `input` (the shard's world entry blob) for one build. */
  static admit(input: unknown, ports: WorldEntryPorts): WorldEntry {
    const entry = new WorldEntry(parseWorldEntry(input), ports);
    entry.live();
    return entry;
  }

  /** Run one block's rows in order; each block runs once per build. */
  async run(block: string): Promise<void> {
    const rows = this.rows.blocks[block];
    if (rows === undefined) throw new Error(`Missing world entry block: ${block}`);
    if (this.ran.has(block)) throw new Error(`World entry block ran twice: ${block}`);
    if (this.ports.scope === undefined && rows.some(row => this.applies(row) && row.kind === 'piece' && row.active !== undefined)) {
      throw new Error('World entry active piece needs its entered scope');
    }
    this.ran.add(block);
    for (const row of rows) if (this.applies(row)) { this.live(); await this.step(row); this.live(); }
  }

  private live(): void {
    if (this.ports.scope?.disposed === true || this.ports.scope?.disposing === true) throw new Error('World entry owner ended');
    this.ports.fence?.();
  }

  private applies(row: WorldEntryStep): boolean {
    const when = row.when;
    return when === undefined || (when.tier === undefined || when.tier === this.ports.tier) && (when.variant === undefined || when.variant === this.ports.variant);
  }

  private async step(row: WorldEntryStep): Promise<void> {
    const { root } = this.ports, scenes = (): SceneHandles => {
      if (this.ports.scenes === undefined) throw new Error(`World entry row ${row.kind} needs the scene handles`);
      return this.ports.scenes;
    };
    if (row.kind === 'place') {
      if (this.tiled.has(row.id) || this.restored.has(row.id)) throw new Error(`World entry placed ${row.id} twice`);
      const handles = scenes();
      if (handles.frozen(row.id)) { await handles.assemble(row.id); this.restored.add(row.id); return; }
      // Frozen sets consume these complete placements later in the same build.
      // Do not publish a tiled root first and then build its owner whole.
      if (handles.requiresWhole(row.id)) { await handles.place(row.id); this.restored.add(row.id); return; }
      // tile streaming T3: a placement goes by tile; the resident's tile driver attaches its copies (T4)
      handles.tile(row.id); this.tiled.add(row.id);
      return;
    }
    // plain state keys only (format/worldEntry MaterialStateSchema): assigned as Material.setValues assigns them
    if (row.kind === 'look') { Object.assign(lentLook(row.look), row.state); return; }
    if (row.kind === 'cut') {
      const physics = this.ports.physics; if (physics === undefined) throw new Error('World entry cut needs its physics');
      cutTerrain(physics, row.cuts);
      return;
    }
    if (row.kind === 'piece') {
      const register = this.ports.piece; if (register === undefined) throw new Error(`World entry piece ${row.id} needs its registration port`);
      const floors = row.floors, policy = row.floorPolicy;
      const scope = this.ports.scope;
      if (row.active !== undefined && scope === undefined) throw new Error('World entry active piece needs its entered scope');
      const guard = row.active === undefined || scope === undefined ? undefined : grappleGuard(scope);
      register({ id: row.id, name: row.name, file: row.file, category: row.category, surface: row.surface, solidFloor: row.solidFloor,
        ...(guard === undefined ? {} : { follows: new Group(), active: () => !guard.open() }),
        ...(row.colliderOwner === undefined ? {} : { colliderOwner: row.colliderOwner }),
        ...(row.object === null ? {} : { object: row.object === undefined ? root : scenes().object(row.object) }),
        colliders: readColliderRows(row.colliders, { kinds: ['box', 'treads'], surfaces: row.surfaces ?? [row.surface], requireSurface: true }),
        ...(floors.length === 0 ? {} : { floor: (x: number, z: number) => floorAtRects(floors, x, z, policy) }) });
      return;
    }
    const object = row.as === 'group' ? scenes().group(row.id) : row.as === 'mesh' ? scenes().mesh(row.id) : scenes().object(row.id);
    if (row.name !== undefined) object.name = row.name;
    if (row.nameAfter !== undefined) object.name = scenes().placementModel(row.nameAfter);
    if (row.castShadow !== undefined) object.castShadow = row.castShadow;
    if (row.userData !== undefined) Object.assign(object.userData, row.userData);
    (row.parent === undefined ? root : scenes().group(row.parent)).add(object);
  }
}
