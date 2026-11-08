// oxlint-disable-next-line import/no-unassigned-import -- Declaration-only import merges the game's equipment vocabulary.
import '../../src/client/game/equipmentTypes.merge';
import type {CreatureRewardState} from '../../src/shared/game/saves';
import type {EquipmentService} from '../../src/client/engine/combat/EquipmentService';
import type {HeldLoadout} from '../../src/client/game/loadout/held';
import type {HeldLauncher} from '../../src/client/game/weapons/heldLauncher';
import type {SkinLocker} from '../../src/client/game/cosmetics/locker';
import type {Inventory} from '../../src/client/game/Inventory';
import type {GridSession} from '../../src/client/game/grid/session';
import type {WorkerClientReport} from '../../src/client/game/shardfile/clientWorker';

export type ProofResult = { ok: boolean } & Record<string, unknown>;
export type ProofStep = (name: string, run: () => ProofResult | Promise<ProofResult>) => Promise<void>;
interface PinePlay { skins: SkinLocker; inventory: Inventory; weapons: EquipmentService }
interface PineShard { play: PinePlay; loadout: HeldLoadout }
/** The installed development hooks after the page's readiness checks. */
export type WorkerWindow = typeof window & {
  __wildshard: Window['__wildshard'] & {
    world: NonNullable<Window['__wildshard']['world']> & { crossbow: HeldLauncher; player: { link: { place: (x: number, y: number, z: number, yaw: number) => void } } };
    shard: PineShard & {
      grid: Pick<GridSession, 'state'> & { current: () => string | null };
      'harness.shard.pine-hollow': PineShard;
      'pine.quest': { shop: () => { open: () => void; close: () => void; o: { goods: { id: string }[] }; onBuy: (good: { id: string }) => boolean } };
    };
  };
  __deathProof: {
    events: { own: boolean; checkpoint: boolean; cause: { kind: string } | null }[];
    shown: boolean; dark: boolean; earlyMove: boolean;
    start: { x: number; z: number } | null;
    end: { x: number; z: number } | null;
  };
  __workerClient: () => WorkerClientReport;
  __workerClientHits: (by: number) => void;
  __pineGrid: PineShard;
  __pineBot: { press: (id: string) => void; end: () => void };
  __workerClientBot: (id: string, x: number, y: number, z: number) => { press: (id: string) => void; end: () => void };
  __workerClientSave: () => Promise<void>;
};

export interface WorkerSaveDocument {
  keys: {
    'creature-rewards'?: { data: { players: Record<string, CreatureRewardState> } };
    continuation?: { data: { tick: number } };
  };
}

/** Observations made while real input goes through the worker. */
export type RepairWindow = WorkerWindow & {
  __returnVictim: { id: string; at: number[]; boars: string[] } | null;
  __windupProof: { events: { id: string; duration: number; at: number }[]; cues: number[]; warning: number | null; hints: string[]; hit: number | null };
  __repairProof: { damage: { amount: number; head: boolean; died: boolean }[]; sounds: string[]; blood: number; kills: number; deaths: string[]; floats: string[]; loose: string[]; sailorAt: number[] | null };
  __pineLife: { carcasses: { a: import('../../src/client/engine/entities/AnimalView').Animal; comeT: number; site: number }[]; ravens: { state: number }[] };
  __hurtProof: { flashes: number; grunts: number; combat: number; shoves: number; arcs: string[]; hits: { amount: number; blow: boolean; at: number[] }[]; pageDamage: number };
};
