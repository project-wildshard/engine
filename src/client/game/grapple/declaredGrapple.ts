import type { Shardfile } from '@wildshard/format/shardSchema';
import type { GrappleRows } from '@wildshard/format/grapple';
import type { EquipmentRow } from '@wildshard/engine/combat/Equipment';
import type { ShardContext } from '@wildshard/engine/game/plugin/context';
import { ItemCatalogue } from '../../../shared/game/loadout/itemCatalogue';
import { declaredGrappleProfile, declaredGrappleRow, type DeclaredGrappleRow } from '../../../shared/game/grapple/declared';
import { hasLentLook, lendLooks } from '../shardfile/lentLooks';
import { runtimeLookMaterials } from '../shardfile/runtimeFolder';
import { GrappleTool, grappleGuard } from './tool';

/** The rope's node count: the ribbon is one quad strip of two vertices a node. */
const ROPE_POINTS = 24;
const HOOK_ICON = '<path d="M12 2.2v9.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="3.4" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M12 11.5c-3.9 0-6.6 2.5-6.9 6.6l1.9-1.3M12 11.5c3.9 0 6.6 2.5 6.9 6.6l-1.9-1.3M12 11.5v10" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>';
const ZIP_ICON = '<path d="M3.5 20.5 18.5 5.5M11 5h8v8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 14.5l4-4M9.5 21l4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>';
const ACCENT = '#ffcf70', LINE = '#8fe3ff', LOCKED = '#d7a546', INK = '#0d1b26';

/** The ribbon's quad strip as a geometry file (`BufferGeometryLoader` JSON): per node two vertices (side -1 and +1,
 *  `aSide.y` its run along the rope), positions written each frame (`Filament.update`). */
export function grappleRibbonTopology(n: number): unknown {
  const side: number[] = [], index: number[] = [], zeros = (): number[] => Array.from({ length: n * 6 }, () => 0);
  for (let i = 0; i < n; i++) {
    const along = i / (n - 1);
    side.push(-1, along, 1, along);
    if (i < n - 1) { const a = i * 2; index.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  }
  const attribute = (itemSize: number, array: number[]) => ({ itemSize, type: 'Float32Array', array, normalized: false });
  return { metadata: { version: 4.7, type: 'BufferGeometry', generator: 'declaredGrapple' }, type: 'BufferGeometry', data: {
    attributes: { position: attribute(3, zeros()), aPrev: attribute(3, zeros()), aNext: attribute(3, zeros()), aSide: attribute(2, side) },
    index: { type: 'Uint16Array', array: index } } };
}

/** ONE-FORMAT OF41c, the page half: what the native grapple's presentation file holds, as the engine's own rows for a plain
 *  upload's grapple mode. The row names its looks (`profile.looks`) and cues; the hints, chip, marks, rope and bursts are
 *  the platform's, so every plain grapple draws its claw, rope, hook marks and lock the way the native host does. */
export function declaredGrapplePresentation(name: string): GrappleRows {
  const hint = (label: string, tone: 'rest' | 'ready' | 'active', icon?: string) => ({ label, tone, ...(icon === undefined ? {} : { icon, accent: ACCENT }) });
  return {
    portraitFov: 78,
    aim: {
      ribbon: grappleRibbonTopology(ROPE_POINTS),
      filament: { uRes: { v2: [1, 1] }, uProjection: { v2: [1, 1] }, uCorePx: 3, uHaloPx: 16, uI: 1, uPulse: -1, uLen: 10, uTime: 0,
        uCore: { v3: [0.6, 0.97, 1] }, uHalo: { v3: [0.12, 0.8, 1] } },
      scanPerFrame: 2, landingStale: 1.2, marks: 8,
      hints: { rest: hint('Lock', 'rest'), ready: hint('Grapple', 'ready', HOOK_ICON), locked: hint('Locked', 'active', HOOK_ICON),
        zip: hint('Zip', 'active', ZIP_ICON), armed: hint('Armed', 'ready', HOOK_ICON), fire: hint('Fire', 'ready', ZIP_ICON) },
      chip: { className: 'ws-grapple-hook', style: { zIndex: '25', padding: '6px 9px', border: `1px solid ${LINE}`, background: `${INK}dd`, color: LINE,
        font: '700 10px monospace', letterSpacing: '1.5px', whiteSpace: 'nowrap' },
      candidate: '◇ HOOK', lockedTouch: '◆ LOCKED · ZIP', lockedDesk: '◆ LOCKED · JUMP', color: LINE, lockedColor: LOCKED },
      mark: { className: 'ws-grapple-mark', style: { zIndex: '24', font: '700 15px monospace', lineHeight: '1', color: LINE,
        textShadow: `0 0 3px ${INK}, 0 0 3px ${INK}, 0 0 9px rgba(143, 227, 255, 0.75)` }, glyph: '◇', color: LINE },
      toasts: { miss: 'GRAPPLE MISSED · REELING', armedTouch: 'GRAPPLE READY · FIRE TO SHOOT', armedDesk: 'GRAPPLE READY · JUMP TO FIRE',
        lockedTouch: 'HOOK LOCKED · ZIP TO FLY', lockedDesk: 'HOOK LOCKED · JUMP TO ZIP' },
      muzzle: [-0.2, -0.23, -0.55], slack: { fire: 1.14, reel: 1.2, hold: 1.005 },
      ropePoints: ROPE_POINTS, claw: 0xd7a546, halo: 0xffcf62, flashes: { muzzle: 0xa8f5ff, bite: 0xffc66a, dock: 0xffd891 }, sparks: 24, name,
      systems: { input: `${name}.input`, rope: `${name}.rope`, update: name }, debug: 'grapple',
    },
    bursts: {
      muzzle: { name: `${name}:muzzle-flash`, shape: 'flake', count: 1, life: 0.13 }, bite: { name: `${name}:bite-flash`, shape: 'flake', count: 1, life: 0.24 },
      dock: { name: `${name}:dock-flash`, shape: 'flake', count: 1, life: 0.12 }, sparks: { name: `${name}:bite-sparks`, shape: 'streak', count: 24, life: 0.7 },
    },
  };
}

/** The equipped tool's id: a `tool.` id, as every equipped tool has. */
export function declaredGrappleToolId(row: Pick<DeclaredGrappleRow, 'id'>): `tool.${string}` {
  return row.id.startsWith('tool.') ? row.id as `tool.${string}` : `tool.${row.id}`;
}

/** The tool's equipment row: its declared `combat/items` row when the shard names one, else the platform's grapple. */
function grappleEquipment(source: Pick<Shardfile, 'items'>, row: DeclaredGrappleRow, id: `tool.${string}`): EquipmentRow {
  const item = source.items.rows.find(entry => entry.kind === 'tool' && (entry.id === row.id || entry.id === id));
  if (item !== undefined && item.equipment !== undefined) {
    const equipment = new ItemCatalogue(source.items).equipment(item.id);
    return { ...equipment, id };
  }
  const name = row.profile.course.name;
  return { id, ui: { name, icon: 'grapple', touch: 'melee', lockOn: false, melee: false, tracers: false, swapIcon: HOOK_ICON },
    meta: { name, icon: 'grapple', blurb: 'LOCK a hook, then JUMP to fly to it.', category: 'tool' } };
}

/** The page's grapple tool for a plain upload's grapple mode, or null: the same `GrappleTool` the native held entry builds,
 *  from the row's profile and hooks with the platform's presentation. `looks` are the graph looks it draws with. */
export function declaredGrappleTool(shard: ShardContext, source: Pick<Shardfile, 'modes' | 'items'>): { readonly tool: GrappleTool; readonly looks: readonly string[] } | null {
  const row = declaredGrappleRow(source);
  if (row === null) return null;
  const id = declaredGrappleToolId(row), profile = declaredGrappleProfile(row, id);
  const tool = new GrappleTool(shard, { equipment: grappleEquipment(source, row, id), profile, presentation: declaredGrapplePresentation(row.id), hooks: row.hooks });
  return { tool, looks: [...new Set(Object.values(profile.looks))] };
}

/** Install a plain upload's grapple on the page (OF41c): its looks compiled and lent from the shard's `look.materials`, the
 *  tool bound to its guard and added to the loadout, where the wire's claw (`clientWorker` `bindClaw`) picks it up. */
export async function installDeclaredGrapplePage(ctx: ShardContext, source: Shardfile): Promise<GrappleTool | null> {
  const made = declaredGrappleTool(ctx, source);
  if (made === null) return null;
  const scope = ctx.scope, missing = made.looks.filter(id => !hasLentLook(id));
  if (missing.length > 0) lendLooks(scope, await runtimeLookMaterials(ctx, source, true, missing));
  if (scope.disposed || scope.disposing) throw new Error('Declared grapple owner ended during its looks');
  const equipment = ctx.app.equipment;
  if (equipment === null) throw new Error('A declared grapple needs the loadout');
  grappleGuard(scope).bind(made.tool);
  equipment.add(made.tool, { locked: false });
  return made.tool;
}
