import * as v from 'valibot';
import type { LastEnd } from '@wildshard/engine/boot/lastEnd';
import { saves } from '@wildshard/engine/saves/runtime';
import type { SaveStore } from '@wildshard/engine/saves/store';
import type { Scope } from '@wildshard/engine/app/scope';

const finite = v.pipe(v.number(), v.finite());
/** Last durable standalone location, independent of inventory/quest save ownership. */
export interface CrashPosition { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly pitch: number }
interface SavedCrash { readonly slug: string; readonly pose: CrashPosition; readonly at: number }
const pose: v.GenericSchema<unknown, CrashPosition> = v.strictObject({ x: finite, y: finite, z: finite, yaw: finite, pitch: finite });
const schema: v.GenericSchema<unknown, SavedCrash | null> = v.nullable(v.strictObject({ slug: v.string(), pose, at: finite }));
const definition = { key: 'session.crash-position', scope: 'device' as const, version: 1, schema, initial: () => null };
export interface CrashResume { readonly slug: string; readonly pose: CrashPosition }

/** Explicit game-owned checkpoint; blocked storage never grants automatic entry. */
export function saveCrashPosition(slug: string, position: CrashPosition, store: SaveStore = saves, now: number = Date.now()): boolean {
  return store.define(definition).write({ slug, pose: position, at: now });
}

/** Save only live standalone play; a terminated process cannot take a final checkpoint. */
export function installCrashCheckpoint(scope: Scope, slug: string, read: () => CrashPosition | null, store: SaveStore = saves): void {
  const capture = (): void => { const position = read(); if (position !== null) saveCrashPosition(slug, position, store); };
  capture(); scope.interval(3000, capture);
  if (typeof document !== 'undefined') scope.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') capture(); });
}

/** Consume once before allocating a world. Intentional exit/reload and unknown worlds never resume. */
export function consumeCrashResume(end: LastEnd, available: readonly { readonly slug: string }[], store: SaveStore = saves): CrashResume | null {
  if (end.kind !== 'unexpected' || end.mode !== 'shard' || !available.some(row => [end.slug].includes(row.slug))) return null;
  const slot = store.define(definition), saved = slot.peek();
  if (saved === null || ![end.slug].includes(saved.slug) || saved.at > end.bootedAt || !slot.write(null)) return null;
  return { slug: saved.slug, pose: saved.pose };
}
