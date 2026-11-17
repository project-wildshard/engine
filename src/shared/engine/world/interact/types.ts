import type { BufferGeometry, Vector3 } from 'three';
import type { ModelDef } from '../../../../client/engine/models/model';
import * as table from '@wildshard/format/interactTable';
/**
 * Interactables kit: the DATA schema (rows, conditions, flags, quest placements) is format's law (SDK-SPLIT SP5c, Q35),
 * `@wildshard/format/interactTable`, with its full description there. The runtime's looks and props stay here.
 */
export type AltarDef = table.AltarDef;
export type BarrelDef = table.BarrelDef;
export type BeaconDef = table.BeaconDef;
export type BenchDef = table.BenchDef;
export type ChestDef = table.ChestDef;
export type ChestItem = table.ChestItem;
export type Cond = table.Cond;
export type DoorDef = table.DoorDef;
export type InteractDef = table.InteractDef;
export type InteractPlacement = table.InteractPlacement;
export type InteractTable = table.InteractTable;
export type KeyDef = table.KeyDef;
export type LeverDef = table.LeverDef;
export type Place = table.Place;
export type PlateDef = table.PlateDef;
export type PoiId = table.PoiId;
export type QuestPlace = table.QuestPlace;
export type QuestPlaceAnchor = table.QuestPlaceAnchor;
export type QuestPlacementPorts = table.QuestPlacementPorts;
export const autoFlag: typeof table.autoFlag = table.autoFlag;
export const bindInteractPlacements: typeof table.bindInteractPlacements = table.bindInteractPlacements;
export const createQuestPlacements: typeof table.createQuestPlacements = table.createQuestPlacements;
export const flagsRaised: typeof table.flagsRaised = table.flagsRaised;
export const flagsRead: typeof table.flagsRead = table.flagsRead;
export const readInteractPlacements: typeof table.readInteractPlacements = table.readInteractPlacements;
export const TRANSIENT_PREFIXES: typeof table.TRANSIENT_PREFIXES = table.TRANSIENT_PREFIXES;

/** Weak actions yield to another reachable prompt. */
/** `wireId`, when a server knows this prompt: what a client's press of it sends. */
export interface Interactable { position: Vector3; radius: number; label: string; onInteract: () => void; weak?: boolean; wireId?: string }

/** A pickup's look (E405: content registers its own — the game's specimen catalogue): its batched model, and the
 *  parts drawn up close, each on the lit or the glow batch, bobbing and spinning (`bob`: rest height, amplitude, spin) */
export interface PickupPart { key: string; batch: 'lit' | 'glow'; geometry: (seed: number) => BufferGeometry; bob?: readonly [number, number, number]; pulse?: number }
export interface PickupLook { model: ModelDef<Record<string, never>>; batch: 'lit' | 'glow'; lift: number; parts: readonly PickupPart[] }
const PICKUP_LOOKS = new Map<string, PickupLook>();
export function registerPickupLook(id: string, look: PickupLook): void { PICKUP_LOOKS.set(id, look); }
export function pickupLook(id: string): PickupLook | undefined { return PICKUP_LOOKS.get(id); }

/** the chest looks and door looks the runtime knows (InteractDef's `look`s) */
export type ChestLook = 'chest' | 'strongbox' | 'treasure';
export type DoorLook = 'plank' | 'grate' | 'sluice';
export interface ChestDims { w: number; d: number; h: number; lidH: number }
/**
 * The props the interaction runtime draws (E405 E417: the props are content, the game's — src/client/game/systems/props/interact.ts —
 * installed by the composition root; the engine keeps the runtime: the kinds, their poses, colliders and prompts).
 * Every part is a geometry in a local frame with its pivot at the origin; `models` are the catalog rows the runtime
 * places each kind's specimens as.
 */
export interface InteractProps {
  CHEST_DIMS: Readonly<Record<ChestLook, ChestDims>>;
  chestBase: (look: ChestLook, seed: number) => BufferGeometry;
  chestLid: (look: ChestLook, seed: number) => BufferGeometry;
  chestGlint: (look: ChestLook, seed: number) => BufferGeometry;
  padlock: (seed: number) => BufferGeometry;
  keyModel: (seed: number) => BufferGeometry;
  doorFrame: (look: DoorLook, w: number, h: number, seed: number) => BufferGeometry;
  doorPanel: (look: DoorLook, w: number, h: number, seed: number) => BufferGeometry;
  leverBase: (seed: number) => BufferGeometry;
  leverHandle: (seed: number) => BufferGeometry;
  plateRim: (size: number, seed: number) => BufferGeometry;
  plateSlab: (size: number, seed: number) => BufferGeometry;
  barrel: (seed: number) => BufferGeometry;
  brazier: (seed: number) => BufferGeometry;
  flame: (seed: number) => BufferGeometry;
  bench: (seed: number) => BufferGeometry;
  altar: (n: number, seed: number) => BufferGeometry;
  altarSocket: (i: number, n: number) => { x: number; y: number; z: number };
  models: {
    seaChest: ModelDef<{ readonly look: ChestLook; readonly locked: boolean }>;
    holdKey: ModelDef<Record<string, never>>;
    door: ModelDef<{ readonly look: DoorLook; readonly w: number; readonly h: number }>;
    lever: ModelDef<Record<string, never>>;
    pressurePlate: ModelDef<{ readonly size: number }>;
    puzzleBarrel: ModelDef<Record<string, never>>;
    beacon: ModelDef<Record<string, never>>;
    bench: ModelDef<Record<string, never>>;
    shardAltar: ModelDef<{ readonly sockets: number }>;
  };
}
let PROPS: InteractProps | null = null;
export function registerInteractProps(props: InteractProps): void { PROPS = props; }
export function interactProps(): InteractProps {
  if (PROPS === null) throw new Error('Interactables: no props installed (the composition root installs the kit\'s: installKitProps)');
  return PROPS;
}
