import type {EquipmentService} from '../../src/client/engine/combat/EquipmentService';
import type {HeldLoadout} from '../../src/client/game/loadout/held';
import type {HeldLauncher} from '../../src/client/game/weapons/heldLauncher';
import type {SkinLocker} from '../../src/client/game/cosmetics/locker';
import type {Inventory} from '../../src/client/game/Inventory';
import type {GridSession} from '../../src/client/game/grid/session';
import type {WorkerClientReport} from '../../src/client/game/shardfile/clientWorker';

export type ProofStep = (name: string, run: () => Record<string, unknown> | Promise<Record<string, unknown>>) => Promise<void>;
interface PinePlay { skins: SkinLocker; inventory: Inventory; weapons: EquipmentService }
interface PineShard { play: PinePlay; loadout: HeldLoadout }
/** The installed development hooks after the page's readiness checks. */
export type WorkerWindow = typeof window & {
  __wildshard: Window['__wildshard'] & {
    world: NonNullable<Window['__wildshard']['world']> & { crossbow: HeldLauncher; player: { link: { place: (x: number, y: number, z: number, yaw: number) => void } } };
    shard: PineShard & {
      grid: GridSession;
      'harness.shard.pine-hollow': PineShard;
      'pine.quest': { shop: () => { open: () => void; close: () => void; o: { goods: { id: string }[] }; onBuy: (good: { id: string }) => boolean } };
    };
  };
  __workerClient: () => WorkerClientReport;
  __workerClientHits: (by: number) => void;
  __workerClientSave: () => Promise<void>;
};
