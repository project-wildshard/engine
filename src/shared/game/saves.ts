import * as v from 'valibot';
import { saves } from '@wildshard/engine/saves/runtime';
import type { SaveSlot } from '@wildshard/engine/saves/store';
import { inventoryKey, purseKey } from './localSaveKeys';

const finite = v.pipe(v.number(), v.finite());
const numbers = v.record(v.string(), finite);
const strings = v.array(v.string());
const define = <S extends v.GenericSchema>(key: string, schema: S, initial: () => v.InferOutput<S>): SaveSlot<v.InferOutput<S>> => saves.define({ key, scope: 'shard', version: 1, schema, initial });
export const progressSave: SaveSlot<{ counts: Record<string, number>; earned: string[]; title: string | null; playS: number; }> = define('progress', v.object({ counts: numbers, earned: strings, title: v.nullable(v.string()), playS: v.optional(finite, 0) }), () => ({ counts: {}, earned: [], title: null, playS: 0 }));
export const inventorySave: SaveSlot<{ counts: Record<string, number>; order: string[]; }> = saves.define(inventoryKey);
export const purseSave: SaveSlot<number> = saves.define(purseKey);
export const ownedSave: SaveSlot<{ owned: string[]; worn: string[]; }> = define('owned', v.object({ owned: strings, worn: strings }), () => ({ owned: [], worn: [] }));
export const bountySave: SaveSlot<Record<string, number>> = define('bounty', numbers, () => ({}));
export const compendiumSave: SaveSlot<Record<string, { s: number; n: number; t: number; b: number; }>> = define('compendium', v.record(v.string(), v.object({ s: finite, n: finite, t: finite, b: finite })), () => ({}));
export const bossesSave: SaveSlot<Record<string, { defeated: boolean; rewardTaken: boolean; kills: number; }>> = define('bosses', v.record(v.string(), v.object({ defeated: v.boolean(), rewardTaken: v.boolean(), kills: finite })), () => ({}));
export const elitesSave: SaveSlot<Record<string, { timer: number; discovered: boolean; skinTaken: boolean; kills: number; retired: boolean; }>> = define('elites', v.record(v.string(), v.object({ timer: finite, discovered: v.boolean(), skinTaken: v.boolean(), kills: finite, retired: v.boolean() })), () => ({}));
/** Legacy actor APIs accept strings until their shard phase; normalize the old identifier at this boundary. */
export function saveSlug(id: string): string { return id.replace(/^chunk:\/\/local\//u, ''); }

/** Weapon finishes retain their pre-flip save document and version. */
export const skinSave: SaveSlot<{ owned: string[]; worn: Record<string, string> }> = define('skins', v.object({ owned: strings, worn: v.record(v.string(), v.string()) }), () => ({ owned: [], worn: {} }));
/** Unclaimed authoritative finish drops survive a reload. */
export const finishPickupSave: SaveSlot<Record<string, { x: number; y: number; z: number }>> = define('finish-pickups', v.record(v.string(), v.object({ x: finite, y: finite, z: finite })), () => ({}));
