import type { SkinLocker } from '../../../client/game/cosmetics/locker';
import type { BagMenuOptions } from '../../../client/game/bag/tabs';
import type { ShardWorld } from '../../../server/game/shard/world';
import type { BodyShadow } from '../../../client/game/cosmetics/bodyShadow';
import type { Audio } from '@wildshard/engine/audio/Audio';
import type { Music } from '@wildshard/engine/audio/Music';
import type { StepSurface } from '@wildshard/engine/audio/surface';
import type { StepRunner } from '@wildshard/engine/boot/plan';
import type { CombatCues } from '@wildshard/engine/combat/cues';
import type { WeaponId } from '@wildshard/engine/combat/Equipment';
import type { EquipmentService } from '@wildshard/engine/combat/EquipmentService';
import type { Targets } from '@wildshard/engine/combat/types';
import type { Weapon } from '@wildshard/engine/combat/Weapon';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import type { RowBodiesView } from '@wildshard/engine/entities/RowBodies';
import type { SkinDef } from '@wildshard/engine/player/Skins';
import type { FirstHints } from '@wildshard/engine/ui/FirstHints';
import type { HUD } from '@wildshard/engine/ui/HUD';
import type { FullMap } from '@wildshard/engine/ui/Map';
import type { GameMenu } from '@wildshard/engine/ui/Menu';
import type { MapMark } from '@wildshard/engine/ui/Minimap';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { Group, Vector2, Vector3 } from 'three';
import type { Inventory } from '../../../client/game/Inventory';
import type { Progress } from '../../../client/game/Progress';
import type { Owned } from '../loot/Owned';
import type { ShardSword } from '../../../client/game/shard/manifest';
import type { Bounds } from '@wildshard/engine/level/spec';

/** Services supplied by the gameplay shell after it has built the player kit and UI. */
export interface ShardPlayHost {
  animals: RowBodiesView; weapons: EquipmentService; primary: Weapon; rifle: Weapon | null; secondary: Weapon | null;
  inventory: Inventory; owned: Owned; progress: Progress; hud: HUD; menu: GameMenu; fullMap: FullMap;
  audio: Audio; music: Music; skins: SkinLocker; wearSkin: (skin: SkinDef) => void;
  touchUi: () => boolean; nolock: boolean; disposeRifleDrop: () => void; cues: CombatCues;
  firstHints?: FirstHints;
  minimap?: { setMarks: (source: (() => readonly MapMark[]) | null) => void; addMarks: (source: () => readonly MapMark[]) => () => void } | null;
  bodyShadow?: BodyShadow | null;
}
export interface ShardPlayHooks {
  meleeSilent?: boolean;
  /** A boot-selected, session-local play area; reload Debug rows can override the manifest without mutating it. */
  levelBounds?: (authored: Bounds | undefined) => Bounds | undefined;
  spawnFloor?: (x: number, z: number) => number | undefined;
  wearFinish?: (id: string) => void;
  updatePickups?: (dt: number, t: number) => void;
  disposeRifleDrop?: () => void;
  animalsReady?: (animals: RowBodiesView) => void;
  /** Awaited right after `animalsReady`: a shard whose creature build is longer than a task builds it here, a task apart per
   *  group (SF67), before the boot moves on (the same spawns in the same order as a one-task build). */
  animalsBuilt?: (animals: RowBodiesView) => Promise<void>;
  worldUpdate?: (dt: number, t: number) => void;
  equipmentUpdate?: (dt: number) => void;
  audioUpdate?: (dt: number) => void;
  dispose?: () => void;
  questFlags?: () => readonly string[];
  adventureFlags?: () => readonly string[];
  places?: () => readonly { id: string; label: string; x: number; z: number; r: number }[];
  checkpoint?: () => boolean;
  eliteEngaged?: () => boolean;
  isElite?: (animal: Animal) => boolean;
  harvestBusy?: () => boolean;
  /** Cancel releases the caller's pending harvest reservation when a scoped gesture leaves before its reward. */
  harvest?: (animal: Animal, give: () => void, cancel?: () => void) => void;
  stepSurface?: (at: Vector3) => StepSurface;
  directional?: boolean;
}
/** Typed, per-build handoff between the staged shell and an authored plugin. */
export interface ShardRuntime {
  world: ShardWorld | null; step: StepRunner | null; play: ShardPlayHost | null;
  readonly interactables: Interactable[];
  readonly overhead: Group[];
  readonly hooks: ShardPlayHooks;
  readonly objects: Record<string, unknown>;
  buildEquipment?: (targets: Targets, nolock: boolean, viewmodel?: ShardSword | null) => Promise<{ primary: Weapon; rifle: Weapon | null; secondary: Weapon | null; extras?: readonly Weapon[]; order?: readonly WeaponId[]; install?: (equipment: EquipmentService) => void }>;
  menu?: Pick<BagMenuOptions, 'skins' | 'onWearSkin' | 'skinsTitle' | 'pack'>;
  viewer: () => Vector3;
  horizonVeil: { value: Vector2 } | null;
}

declare module '@wildshard/engine/events/maps' {
  interface AskMap {
    'feat.toast': [{ id: string; event?: string; allowed: boolean }, { id: string; event?: string; allowed: boolean }];
  }
}

/** Select the staged bounds override once before installing normal fall recovery; absent hooks retain authored policy. */
export function resolveLevelBounds(authored: Bounds | undefined, hooks: ShardPlayHooks): Bounds | undefined {
  return hooks.levelBounds?.(authored) ?? authored;
}
