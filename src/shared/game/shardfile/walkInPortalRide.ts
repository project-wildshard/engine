/** Renderer-free walk-in portal state machine. The API consumes declared links,
 * trigger/fade rows and feet observations, and returns hold/transfer commands.
 * The existing traversal owner validates physics; a presenter draws the veil.
 * No authored callback or shard identifier enters this host. */
import * as v from 'valibot';
import { DirectorStageLane } from '../plugin/director';
import { parseDirectorStages } from '@wildshard/format/directorStages';
import type { PortalTransfer } from './portalTraversal';
import type { PortalLinkEntry } from '@wildshard/format/portalLinkAssets';

export type PortalRideCommand = { readonly kind: 'hold'; readonly on: boolean } | { readonly kind: 'transfer'; readonly from: string };
type ShardEdge = PortalLinkEntry['edge'];
interface RingPortal { readonly id: string; readonly x: number; readonly y: number; readonly z: number; readonly nx: number; readonly nz: number }
interface RingTrigger { readonly front: number; readonly back: number; readonly half: number; readonly feet: number; readonly reach?: number }

/** Test the authored ring's walk-in volume in its own cardinal frame. */
function inRingPortal(p: RingPortal, t: RingTrigger, x: number, y: number, z: number): boolean {
  const dx = x - p.x, dz = z - p.z, along = dx * p.nx + dz * p.nz, across = -dx * p.nz + dz * p.nx;
  return along >= -t.front && along <= t.back && Math.abs(across) <= t.half && Math.abs(y - p.y) <= t.feet;
}

/** s: the fade to dark, the hold in the dark (the move happens as it starts), the fade back */
export interface RideFade { readonly out: number; readonly hold: number; readonly in: number }

/** the rings a ride watches: the roads', the way out's, their walk-in volume and the fade */
export interface RideRings {
  readonly entries: readonly PortalLinkEntry[];
  readonly trigger: RingTrigger;
  readonly fade: RideFade;
  /** The admitted portal stages; the page and native host consume the root declaration. */
  readonly stages: unknown;
}

/** the ride's whole state: the road you came in by, whether a ring is armed, the fade clock (−1 at rest), the node it
 *  rides from, whether the transfer is done, and the session's transfers and refusals */
export interface PortalRideState {
  readonly version: 2; readonly director: string;
  readonly entered: ShardEdge | null; readonly armed: boolean; readonly t: number; readonly from: string; readonly moved: boolean;
  readonly rides: readonly PortalTransfer[]; readonly refused: readonly string[];
}
const finite = v.pipe(v.number(), v.finite());
/** Strict versioned native portal fields; the installed director validates its own complete contract/cursor. */
export const PortalRideStateSchema: v.GenericSchema<BoundedPortalRideSaveInput, BoundedPortalRideSave> = v.strictObject({
  version: v.literal(2), director: v.string(),
  entered: v.nullable(v.picklist(['north', 'east', 'south', 'west'])), armed: v.boolean(), t: finite, from: v.string(), moved: v.boolean(),
  rides: v.array(v.strictObject({ from: v.string(), to: v.string(), yaw: finite })), refused: v.array(v.string()),
});

export interface PortalRideFrame { readonly commands: readonly PortalRideCommand[]; readonly veil: number }
export interface PortalRideLane {
  readonly entered: () => ShardEdge | null; readonly busy: () => boolean;
  readonly rides: () => readonly PortalTransfer[]; readonly refused: () => readonly string[];
  readonly observe: (dt: number, feet: { readonly x: number; readonly y: number; readonly z: number }) => PortalRideFrame;
  readonly complete: (transfer: PortalTransfer) => void; readonly refuse: (reason: string) => void;
  readonly snapshot: () => PortalRideState; readonly restore: (state: PortalRideState) => void;
}
export function createPortalRide(rings: RideRings): PortalRideLane {
  const { entries, trigger, fade } = rings;
  v.parse(v.strictObject({ front: finite, back: finite, half: finite, feet: finite, reach: v.exactOptional(finite) }), trigger);
  v.parse(v.strictObject({ out: finite, hold: finite, in: finite }), fade);
  if (Object.values(trigger).some(value => value < 0) || fade.out <= 0 || fade.in <= 0 || fade.hold < 0) throw new Error('Invalid portal trigger or fade');
  const stages = parseDirectorStages(rings.stages);
  const inputs = Object.fromEntries(['touch', 'dark', 'clear'].map(key => {
    const binding = stages.inputs[key];
    if (binding === undefined) throw new Error('Portal ride requires touch, dark and clear observations');
    return [key, binding];
  }));
  const director = new DirectorStageLane({ ...stages, inputs });
  let opacity = 0;
  let position: { readonly x: number; readonly y: number; readonly z: number } = { x: Infinity, y: Infinity, z: Infinity };
  const commands: PortalRideCommand[] = [];
  const observation = { touch: false, dark: false, clear: false };
  const actions = new Set(['portal.hold', 'portal.transfer', 'portal.clear']);
  if (director.data.stages.some(stage => stage.do.length > 1 || stage.do.some(action => !('emit' in action) || action.value !== 0 || !actions.has(action.emit)))) throw new Error('Invalid portal director action');
  // Idle admission is quiet: no native hold, teleport, veil or release runs while installing/restoring.
  director.step(0, observation);
  const select = (input: keyof typeof observation, eligible: boolean, event: string): boolean => {
    observation[input] = eligible;
    try {
      const action = director.step(director.tick + 1, observation)[0];
      return action !== undefined && 'emit' in action && action.emit === event;
    } finally { observation[input] = false; }
  };
  // Canonical quarter-turn node yaw reads exact axes; never introduce sine round-off into trigger boundaries.
  const heading = (yaw: number): { nx: number; nz: number } => {
    if (yaw === 0) return { nx: 0, nz: -1 };
    if (yaw === Math.PI || yaw === -Math.PI) return { nx: 0, nz: 1 };
    if (yaw === Math.PI / 2) return { nx: -1, nz: 0 };
    if (yaw === -Math.PI / 2) return { nx: 1, nz: 0 };
    return { nx: -Math.sin(yaw), nz: -Math.cos(yaw) };
  };
  const ring = (node: PortalLinkEntry['portal']['road'], inward = false): RingPortal => {
    const direction = heading(node.yaw), [x, y, z] = node.at, sign = inward ? -1 : 1;
    return { id: node.id, x, y, z, nx: direction.nx * sign + 0, nz: direction.nz * sign + 0 };
  };
  const roads = entries.map(row => ({ ...ring(row.portal.road, true), edge: row.edge }));
  const exits = entries.map(row => ({ edge: row.edge, ring: ring(row.portal.exit) }));
  if (roads.length === 0 || new Set(roads.map(row => row.edge)).size !== roads.length) throw new Error('Portal ride requires distinct declared entries');
  let entered: ShardEdge | null = null, armed = true, t = -1, from = '', moved = false;
  const done: PortalTransfer[] = [], refused: string[] = [];
  const missingExit = new Error('Portal continuation has no declared exit');
  const exitFor = (row: typeof exits[number]): boolean => row.edge === (entered ?? roads[0]?.edge);
  /** the declared node the ring you stand in is: a road's portal, or the way out's exit bound to your road */
  const touching = (): string | null => {
    const { x, y, z } = position;
    for (const p of roads) if (inRingPortal(p, trigger, x, y, z)) return p.id;
    const out = exits.find(exitFor)?.ring;
    if (out === undefined) throw missingExit;
    if (inRingPortal(out, trigger, x, y, z)) return out.id;
    return null;
  };
  const complete = (transfer: PortalTransfer): void => {
    if (!entries.some(entry => entry.portal.links.some(link => link.from === transfer.from && link.to === transfer.to))) throw new Error('Transfer does not bind a declared portal link');
    done.push({ ...transfer });
    const road = roads.find(row => row.id === transfer.from);
    if (road !== undefined) entered = road.edge;
  };
  const advance = (dt: number): void => {
    if (t < 0) {
      const hit = touching();
      if (hit === null) { armed = true; return; }
      if (!select('touch', armed, 'portal.hold')) return;
      from = hit; t = 0; moved = false; armed = false;
      commands.push({ kind: 'hold', on: true });
    }
    t += Math.min(dt, 0.1);
    if (select('dark', !moved && t >= fade.out, 'portal.transfer')) { commands.push({ kind: 'transfer', from }, { kind: 'hold', on: false }); moved = true; }
    const back = fade.out + fade.hold;
    opacity = t < fade.out ? t / fade.out : t < back ? 1 : Math.max(0, 1 - (t - back) / fade.in);
    if (select('clear', t >= back + fade.in, 'portal.clear')) { t = -1; opacity = 0; }
  };
  const snapshot = (): PortalRideState => ({ version: 2, director: director.snapshot(), entered, armed, t, from, moved, rides: done.map((r) => ({ ...r })), refused: [...refused] });
  const restore = (input: PortalRideState): void => {
    const state = v.parse(PortalRideStateSchema, input);
    director.restore(state.director);
    entered = state.entered; armed = state.armed; t = state.t; from = state.from; moved = state.moved;
    done.splice(0, done.length, ...state.rides.map((r) => ({ ...r }))); refused.splice(0, refused.length, ...state.refused);
  };
  return { entered: () => entered, busy: () => t >= 0, rides: () => done, refused: () => refused, observe: (dt: number, feet: typeof position) => { position = feet; commands.length = 0; advance(dt); return { commands: [...commands], veil: opacity }; }, complete, refuse: (reason: string): void => { refused.push(reason); }, snapshot, restore };
}


/** Complete admitted data, independent of validator implementation metadata. */
type BoundedPortalRideSaveInput = BoundedPortalRideSave;
interface BoundedPortalRideSaveFields {
    version: 2;
    director: string;
    entered: "north" | "east" | "south" | "west" | null;
    armed: boolean;
    t: number;
    from: string;
    moved: boolean;
    rides: {
        from: string;
        to: string;
        yaw: number;
    }[];
    refused: string[];
}
type BoundedPortalRideSave = { [Key in keyof BoundedPortalRideSaveFields]: BoundedPortalRideSaveFields[Key] };
