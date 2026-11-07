import * as v from 'valibot';
import type { ContractCatalogue, ContractReward } from '@wildshard/format/contracts';
import { claim, contractFor, loadBoard, recordKill, reroll, projectContract, type Board, type KillInfo } from './contracts';

const integer = v.pipe(v.number(), v.finite(), v.safeInteger(), v.minValue(0));
const BoardState: v.GenericSchema<BoundedContractBoardSaveInput, BoundedContractBoardSave> = v.strictObject({ next: integer,
  slots: v.pipe(v.array(v.strictObject({ serial: integer, kind: v.string(), target: v.string(), have: integer })), v.maxLength(8)),
  claimed: integer, streak: integer, best: integer });
const Saved = v.strictObject({ version: v.literal(1), open: v.boolean(), board: BoardState });
interface Point { readonly x: number; readonly y: number; readonly z: number }

/** Native board actions follow the page panel: open at its actual prompt, then claim/tear a selected slot while open.
 * Closing is explicit; the page panel has no walk-away closure. The entry point supplies captured prompt coordinates. */
export const CONTRACT_ACTION = { open: 0, close: 1, claim0: 10, tear0: 20 } as const;
/** Data-only modal board. A successful claim returns rewards for the existing inventory owner. */
export interface ContractBoardRows {
  readonly contracts: ContractCatalogue; readonly prompt: Point; readonly radius: number;
  /** Existing page save text; native continuation still uses prepareRestore. */
  readonly saved?: string | null;
}
export interface ContractClaim { readonly reward: ContractReward; readonly streak: number }

function boardFrom(contracts: ContractCatalogue, value: unknown): Board {
  const saved = v.parse(BoardState, value);
  const slots = saved.slots.map(slot => {
    const authored = contractFor(contracts, slot.serial, slot.kind, slot.target);
    if (authored === null) throw new RangeError('Invalid contract board contract');
    return { ...authored, have: slot.have };
  });
  const candidates = slots.map(slot => ({ serial: slot.serial, have: slot.have, need: slot.need, valid: 1 }));
  // The same detached snapshot lends each candidate in order; no state mutates before every refusal check passes.
  if (slots.length === 0 || slots.some((_, candidate) => projectContract(contracts, 'restore', { candidate,
    count: slots.length, slots: contracts.slots, next: saved.next, claimed: saved.claimed,
    best: saved.best, streak: saved.streak }, candidates)['value'] !== 1)) throw new RangeError('Invalid contract board continuation');
  return { next: saved.next, slots, claimed: saved.claimed, streak: saved.streak, best: saved.best };
}

/** Renderer-free keeper for the authored contract law. Restore is bounded, silent and atomic; words/rewards are rebuilt
 * from today's authored table, never accepted from a save. Every real death advances the same overlapping slots. */
export class ContractBoard {
  private board: Board;
  private opened = false;
  private readonly ports: ContractBoardRows;
  constructor(ports: ContractBoardRows) {
    this.ports = ports; this.board = loadBoard(ports.contracts, ports.saved ?? null);
    if (![ports.prompt.x, ports.prompt.y, ports.prompt.z, ports.radius].every(Number.isFinite) || ports.radius <= 0) {
      throw new RangeError('Invalid contract board prompt');
    }
  }
  get active(): boolean { return this.opened; }
  /** The page borrows this live value for its existing panel and Developer view. */
  get current(): Board { return this.board; }
  /** Take the board from who owns it (J130), in its saved form. */
  mirror(raw: string): void { Object.assign(this.board, boardFrom(this.ports.contracts, JSON.parse(raw))); }
  killed(kill: KillInfo): number[] { return recordKill(this.ports.contracts, this.board, kill); }
  /** Page panels own their modal; native use() applies the same slot operation. */
  claim(slot: number): ContractClaim | null {
    if (!this.validSlot(slot)) return null;
    const reward = claim(this.ports.contracts, this.board, slot);
    return reward === null ? null : { reward, streak: this.board.streak };
  }
  tear(slot: number): void {
    if (this.validSlot(slot)) reroll(this.ports.contracts, this.board, slot);
  }
  private validSlot(slot: number): boolean {
    if (!Number.isInteger(slot) || this.board.slots[slot] === undefined) return false;
    if (this.board.next === Number.MAX_SAFE_INTEGER) throw new RangeError('contract board draw capacity exhausted');
    return true;
  }
  use(value: number, eye: Point): ContractClaim | null {
    const pointValid = [eye.x, eye.y, eye.z].every(Number.isFinite), valid = Number.isFinite(value), prompt = this.ports.prompt;
    const next = projectContract(this.ports.contracts, 'use', { value: valid ? value : 0, valid: Number(valid),
      open: Number(this.opened), slots: this.ports.contracts.slots, pointValid: Number(pointValid),
      x: pointValid ? eye.x : 0, y: pointValid ? eye.y : 0, z: pointValid ? eye.z : 0,
      px: prompt.x, py: prompt.y, pz: prompt.z, radius: this.ports.radius });
    this.opened = next['open'] === 1;
    const slot = next['slot'];
    if (slot === undefined) throw new Error('Missing board projection slot');
    if (next['operation'] === 2) { this.tear(slot); return null; }
    return next['operation'] === 1 ? this.claim(slot) : null;
  }
  snapshot(): { version: 1; open: boolean; board: v.InferOutput<typeof BoardState> } {
    const b = this.board;
    return { version: 1, open: this.opened, board: { next: b.next, slots: b.slots.map(c => ({ serial: c.serial, kind: c.kind, target: c.target, have: c.have })),
      claimed: b.claimed, streak: b.streak, best: b.best } };
  }
  prepareRestore(value: unknown): () => void {
    const saved = v.parse(Saved, value), board = boardFrom(this.ports.contracts, saved.board);
    return () => { this.board = board; this.opened = saved.open; };
  }
  restore(value: unknown): void { this.prepareRestore(value)(); }
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedContractBoardSaveInput = BoundedContractBoardSave;
interface BoundedContractBoardSaveFields {
    next: number;
    slots: {
        serial: number;
        kind: string;
        target: string;
        have: number;
    }[];
    claimed: number;
    streak: number;
    best: number;
}
type BoundedContractBoardSave = { [Key in keyof BoundedContractBoardSaveFields]: BoundedContractBoardSaveFields[Key] };
