import type { Scope } from '../app/scope';
import type { InputService } from '../../../client/engine/input/InputService';
import type { AimCommand } from '../input/commands';
import type { ItemRuntime, ItemSpec, ItemHook } from './items';
import type { EquipmentRow, WeaponUi } from './Equipment';
import type { Weapon } from './Weapon';
import type { Tool } from './Tool';

/** Renderer-neutral parameters selecting a registered kit view recipe. */
export interface ItemViewRecipe { asset?: string; recipe: string; colour: string; position: readonly [number, number, number]; rotation: readonly [number, number, number] }
/** A trusted session binds standard input and one authoritative runtime to each kit family. */
export interface ItemFamilyPorts { scope: Scope; runtime: ItemRuntime; input: Pick<InputService, 'bind' | 'held'>; aim: () => AimCommand; view: ItemViewRecipe;
  /** Validated numeric author data, supplied only to a family that explicitly admits its profile kind. */
  profile?: unknown;
  /** Admitted contact data and action selection supplied by the trusted loader. */
  contacts?: unknown;
  /** Omit code for a direct secondary contact; a code requires its actor-bound script hook. */
  secondary?: { readonly action: string; readonly code?: 3 | 4; readonly move: number };
  hook?: ItemHook;
  /** An admitted static equipment model; the asset lease owns its shared geometry and materials. */
  model?: unknown;
}
/** Trusted family presentation; declared identity, slot, input context, name, icon and swap glyph remain authoritative. */
export type ItemFamilyPresentation = Pick<EquipmentRow, 'cues' | 'hitStop' | 'rangedFeel'> & {
  ui?: Partial<Omit<WeaponUi, 'name' | 'icon' | 'inputContext' | 'swapIcon'>>;
};
/** Injected kit constructors; the game never imports a kit or constructs a second combat actor. */
export type ItemFamily = ({ kind: 'weapon'; create: (row: EquipmentRow, spec: Extract<ItemSpec, { kind: 'weapon' }>, ports: ItemFamilyPorts) => Weapon }
  | { kind: 'tool'; create: (row: EquipmentRow, spec: Extract<ItemSpec, { kind: 'tool' }>, ports: ItemFamilyPorts) => Tool }) & { presentation?: ItemFamilyPresentation;
  /** Explicit profile kinds consumed by this native implementation; absent means legacy rows only. */
  profiles?: readonly string[];
  /** TE-ENG2: the family's weapons start locked, and an item scene (a rack's prompt) unlocks them; absent means unlocked at install. */
  locked?: boolean;
};
