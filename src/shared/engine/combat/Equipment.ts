import type { Scope } from '../app/scope';
import type { AttributeSet, CueId } from '../../../client/engine/combat/effects/types';
import type { CombatTag } from './pipeline';
import type { HitStopProfile } from '../../../client/engine/combat/cues';
import type { Events } from '../events/events';
import type { EquipmentPickupSpec } from '../../../server/engine/combat/EquipmentPickup';

interface RangedFeelProfile {
  kick: { body: number; head: number; kill: number; side: number; killSide: number };
  trauma: { kill: number; head: number; killKinds: readonly string[]; headKinds: readonly string[] };
}



/** Hosts declare their slot, icon and touch-layout vocabularies without importing content into simulation. */
// oxlint-disable-next-line typescript/no-empty-object-type, typescript/no-empty-interface -- Host extension point populated by declaration merging.
export interface EquipmentSlotMap {}
// oxlint-disable-next-line typescript/no-empty-object-type, typescript/no-empty-interface -- Host extension point populated by declaration merging.
export interface EquipmentIconMap {}
export interface EquipmentTouchMap { melee: true; bow: true; ranged: true }
export type WeaponId = keyof EquipmentSlotMap;
export type EquipmentIcon = keyof EquipmentIconMap;
export type ToolId = `tool.${string}`;
export type EquipmentId = `weapon.${string}` | ToolId;
export interface WeaponUi {
  name: string; icon: EquipmentIcon;
  /** Magazine readouts offer touch reload; quivers keep their passive ammo chip. */
  ammo?: { label: string; segments: number; magazine?: boolean; bagLabel?: string; bagLabelFor?: string };
  inputContext?: string;
  touch: keyof EquipmentTouchMap;
  lockOn: boolean; melee: boolean; tracers: boolean;
  /** The existing 24px swap glyph and short label; menu icons use the shared 64px icon library. */
  swapIcon: string; swapName?: string;
  huntersEye?: boolean;
}
export interface EquipmentMeta { name: string; icon: EquipmentIcon; blurb: string; category: string }
/** a weapon's sound cues: fire, reload, impact, and the optional dry, hit, heavy and charge cues */
export interface EquipmentCues { fire: CueId; reload: CueId; impact: CueId; dry?: CueId; hit?: CueId; heavy?: CueId; charge?: Readonly<Record<string, CueId>> }
export interface EquipmentRow { pickup?: EquipmentPickupSpec; rangedFeel?: RangedFeelProfile; cues?: EquipmentCues; hitStop?: HitStopProfile; tags?: readonly CombatTag[]; id: EquipmentId; legacySlot?: WeaponId; ui: WeaponUi; meta: EquipmentMeta }
export interface EquipmentBlock { dispose: () => void }
export type BlockSet = Partial<Record<'vm' | 'aim' | 'ads' | 'melee' | 'projectile' | 'hitStop' | 'ammo' | 'brass', EquipmentBlock>>;
/** The scope is sufficient for the legacy families; block/input/combat ports expand as their migration rows land. */
export interface EquipContext { scope: Scope; events?: Events }

export abstract class Equipment {
  readonly attributes: AttributeSet = {};
  effectTags: readonly CombatTag[] = [];
  abstract readonly id: keyof (EquipmentSlotMap & Record<ToolId, true>);
  abstract holster: number;
  abstract enabled: boolean;
  protected readonly blocks: BlockSet = {};
  private owner: Scope | undefined;
  protected equipEvents: Events | undefined;
  row: EquipmentRow;
  constructor(row: EquipmentRow) { this.row = row; }
  get meta(): EquipmentMeta { return this.row.meta; }
  get name(): string { return this.row.ui.name; }
  install(ctx: EquipContext): void {
    if (this.owner) throw new Error(`Equipment ${this.row.id} is already installed`);
    this.owner = ctx.scope;
    this.equipEvents = ctx.events;
    ctx.scope.onDispose(() => { this.enabled = false; for (const block of Object.values(this.blocks)) block.dispose(); });
  }
  abstract update(dt: number, t: number): void;
  dispose(): void { this.owner?.dispose(); }
}
