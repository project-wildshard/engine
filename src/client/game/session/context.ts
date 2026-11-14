import type { ShardContext } from "../plugin/context";
import type { Audio } from '@wildshard/engine/audio/Audio';
import type { Music } from '@wildshard/engine/audio/Music';
import type { StepProgress } from '@wildshard/engine/boot/plan';
import type { TitleArrival } from '@wildshard/engine/boot/titleArrival';
import type { CombatCueMap } from '@wildshard/engine/combat/cues';
import type { Tool } from '@wildshard/engine/combat/Tool';
import type { Player } from '@wildshard/engine/player/Player';
import type { SkinDef } from '@wildshard/engine/player/Skins';
import type { ItemRow } from '../../../shared/game/bag/items';
import type { ShardManifest } from '../shard/manifest';
import type { ShardRuntime } from '../../../shared/game/shard/runtime';
import type { TravelHandoff } from '../travel/travel';
import type { BagIcons } from '../bag/tabs';
import type { Scene, PerspectiveCamera } from 'three';
import type { LoadStage } from '../shard/load';
import type { GridRecoveryRecord } from '../../../shared/game/grid/recovery';
import type { PageResidency } from '../grid/pageResidency';
import type { MemoryAdmission } from '@wildshard/format/memoryAdmission';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import type { CrashResume } from './crashResume';

export interface KitPorts {
  items: readonly ItemRow[];
  tools: readonly { id: string; create: (camera: PerspectiveCamera, player: Player) => Tool }[];
  combatCues: (audio: Audio, meleeSilent: boolean) => CombatCueMap;
  /** the bag's glyphs (AG4: the game names no content icon) */
  bagIcons: BagIcons;
}
export interface SessionState {
  readonly crashResume?: CrashResume;
  /** G226: the page is only a platform shell; even its initial hybrid home is an evictable owned region. */
  ownedGridHome?: boolean;
  /** G216's trusted policy, including validation warnings before the ordinary HUD has been constructed. */
  readonly memory?: MemoryAdmission;
  /** Created before manifest hydration; the level disposes it after its allocated consumers. */
  readonly residency?: PageResidency;
  /** Consume-once recovery metadata, admitted before hydration. */
  readonly recovery?: NonNullable<GridRecoveryRecord>;
  music: Music | null;
  arrival: TitleArrival | null;
  fatalShown: boolean;
}
export interface BuiltWorld { readonly scene: Scene; dispose: () => void }
export interface StagedBoot {
  /** The actual staged context lent to admitted regional runtimes after page gameplay exists. */
  context?: ShardContext;
  runtime: ShardRuntime;
  skins: readonly SkinDef[];
  progress: StepProgress;
  worldHook: (work: () => Promise<void>) => Promise<void>;
  handoff: TravelHandoff | null;
  items: ReadonlyMap<string, ItemRow>;
  featTotal: number | undefined;
}
export interface SessionContext {
  manifest: ShardManifest; slug: string; stage: LoadStage;
  boot: StagedBoot; session: SessionState; kit: KitPorts;
  /** the shard's built output, loaded before the first hook; bound into its look and roster loaders (`toLevelSpec`) */
  product: ShardFolder;
}
