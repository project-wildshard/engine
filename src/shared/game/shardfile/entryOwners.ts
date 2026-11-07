/** Client-only concrete loans between compiled entry capabilities. No shard
 * callbacks, reflected paths, clocks or continuation state live in this book. */
import type { Object3D, Vector3 } from 'three';
import type { StealthController } from '../../../client/game/stealth/controller';
import type { TimedEncounters } from '../../../client/game/boss/timedEncounters';
import type { SpeciesCatalogue } from '../../../client/game/looks/speciesBook';
import type { DeclaredEliteEntry } from '@wildshard/engine/ai/view/eliteEntry';
import type { EliteEntryPageRows } from '@wildshard/format/eliteEntryRows';
import type { EliteDeclaredEntryOwners } from '../../../client/game/Elite';
import type { ArenaRoomEncounter } from '../../../client/game/boss/arenaRoom';
import type { PageTamingOwner, PageRidingView } from '../../../client/game/riding/client';
import type { AdventurePersistence } from '../quest/persistence';
import type { ModelSiteLayout, Placed } from '@wildshard/engine/models/place';
import type { ForestWeatherRig } from '../../../client/game/weather/forest';
import type { FixedDraws } from '../../../client/game/models/fixedDraws';
import type { RopeDeckSite } from '../../../client/game/models/ropeDeckSite';
import type { RowBodiesView } from '@wildshard/engine/entities/RowBodies';
import type { DeclaredSoundBank } from '@wildshard/engine/audio/declaredBank';
import type { QuestSpawnResult } from '../../../client/game/quest/chapterDirector';
import type { Scope } from '@wildshard/engine/app/scope';
import type { RopeChain } from '@wildshard/engine/physics/ropeChain';
import type { AmbientGroup } from '../ambient/flock';
import type { AmbientFlockDraw } from '../../../client/game/ambient/ambientFlock';
import type { CollectionCatalogue } from '../../../client/game/models/collectionDisplay';
import type { HeldClaims } from '../../../client/game/loadout/claims';
import type { QuestPageComposition } from '../../../client/game/quest/pageComposition';
import type { QuestPageReference } from '../../../client/game/quest/pageReference';
import type { CaveInterior } from '../../../client/game/shardfile/caveInterior';
import type { ForestPage } from '../../../client/game/shardfile/forestPage';
import type { SceneHandles } from '../../../client/game/shardfile/sceneHandles';
import type { LivingBuildings } from '../../../client/game/shardfile/livingBuildings';
import type { PainterlyWorld } from '../../../client/game/looks/postGraphLook';

/** Existing entered owners expose their two native frame slots without another clock or saved state. */
export interface WorldFrameOwner { readonly update: (dt: number, time: number) => void; readonly late: (dt: number, time: number) => void }

/** Original elite construction resources, lent to the existing entered engine
 * feature. No factory, shard object, reflected path or new durable owner. */
export interface EliteEntryConstruction extends Pick<EliteDeclaredEntryOwners,
  'construction' | 'models' | 'program' | 'environment' | 'clock' | 'weather' | 'ledges' | 'patrol'> {
  readonly entry: DeclaredEliteEntry;
  readonly rows: EliteEntryPageRows;
}

/** A kind names a concrete platform owner, never an arbitrary shard result. */
export interface EntryOwnerTypes {
  'world-groups': Record<string, Object3D>;
  'world-frame': WorldFrameOwner;
  'elite-entry': EliteEntryConstruction;
  scenes: SceneHandles;
  'world-weather': ForestWeatherRig;
  'world-point': Vector3 | null;
  'arena-room': ArenaRoomEncounter;
  taming: PageTamingOwner;
  'riding-view': Pick<PageRidingView, 'mount' | 'taming' | 'interactable'>;
  'riding-play': PageRidingView;
  stealth: StealthController;
  'timed-encounters': TimedEncounters;
  adventure: AdventurePersistence;
  species: SpeciesCatalogue;
  buildings: LivingBuildings;
  forest: ForestPage;
  cave: CaveInterior;
  quest: QuestPageComposition;
  'quest-reference': QuestPageReference;
  object: Object3D;
  placed: readonly Placed[];
  site: ModelSiteLayout['anchors'];
  floor: ModelSiteLayout['floorHeightAt'];
  'fixed-draws': FixedDraws;
  'drawn-models': ReadonlyMap<string, Object3D>;
  chain: RopeChain;
  'rope-deck': ReturnType<RopeDeckSite['place']>;
  ambient: AmbientGroup;
  'ambient-draw': AmbientFlockDraw;
  collection: CollectionCatalogue;
  claims: HeldClaims;
  animals: RowBodiesView;
  sounds: DeclaredSoundBank;
  'quest-spawns': QuestSpawnResult;
  'painted-world': PainterlyWorld;
}
export type EntryOwnerKind = keyof EntryOwnerTypes;
interface Loan<T> { readonly owner: Scope; readonly value: T }
type Owners = { [K in EntryOwnerKind]: Map<string, Loan<EntryOwnerTypes[K]>> };
const books = new WeakMap<Scope, Owners>();

function check(scope: Scope, id: string): void {
  if (scope.disposed || scope.disposing) throw new Error('Entry owner scope has ended');
  if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,255}$/u.test(id)) throw new Error('Invalid entry owner id');
}
function book(scope: Scope): Owners {
  let value = books.get(scope);
  if (value === undefined) {
    value = { 'world-groups': new Map(), 'elite-entry': new Map(), 'world-frame': new Map(), scenes: new Map(), 'world-weather': new Map(), 'world-point': new Map(), 'arena-room': new Map(), taming: new Map(), 'riding-view': new Map(), 'riding-play': new Map(), stealth: new Map(), 'timed-encounters': new Map(), adventure: new Map(), species: new Map(), buildings: new Map(), forest: new Map(), cave: new Map(), quest: new Map(), 'quest-reference': new Map(),
      object: new Map(), placed: new Map(), site: new Map(), floor: new Map(), 'fixed-draws': new Map(), 'drawn-models': new Map(), chain: new Map(), 'rope-deck': new Map(), ambient: new Map(), 'ambient-draw': new Map(), collection: new Map(), claims: new Map(),
      animals: new Map(), sounds: new Map(), 'quest-spawns': new Map(), 'painted-world': new Map() };
    books.set(scope, value);
  }
  return value;
}
function loan<K extends EntryOwnerKind>(scope: Scope, kind: K, id: string): Loan<EntryOwnerTypes[K]> {
  check(scope, id);
  const value = books.get(scope)?.[kind].get(id);
  if (value === undefined || value.owner.disposed || value.owner.disposing) throw new Error(`Missing live entry owner: ${kind}/${id}`);
  return value;
}
function publish<K extends EntryOwnerKind>(scope: Scope, kind: K, id: string, value: Loan<EntryOwnerTypes[K]>): void {
  check(scope, id);
  const entries: Map<string, Loan<EntryOwnerTypes[K]>> = book(scope)[kind];
  if (entries.has(id)) throw new Error(`Duplicate entry owner: ${kind}/${id}`);
  entries.set(id, value);
  let forgetOwner = (): void => undefined, forgetBorrower = (): void => undefined;
  const release = (): void => { entries.delete(id); forgetOwner(); forgetBorrower(); };
  forgetBorrower = scope.capture('disposers', release);
  if (value.owner !== scope) forgetOwner = value.owner.capture('disposers', release);
}
/** Called by the platform constructor after its data-backed resource is ready.
 * Publication lends the value; its original host alone disposes the resource. */
export function publishEntryOwner<K extends EntryOwnerKind>(scope: Scope, kind: K, id: string, value: EntryOwnerTypes[K]): void {
  publish(scope, kind, id, { owner: scope, value });
}
/** Entered capabilities borrow only from their own live construction ancestor.
 * The original owner survives transitive loans; either scope ending drops the
 * loan and both cleanup registrations without disposing a borrowed resource. */
export function lendEntryOwner(scope: Scope, source: Scope, kind: EntryOwnerKind, id: string): void {
  const value = loan(source, kind, id);
  if (scope === source || !scope.belongsTo(value.owner)) throw new Error('Entry loan requires its construction ancestor');
  publish(scope, kind, id, value);
}
/** `entryOwner`, or null while that row id is not (or no longer) published in the scope. */
export function presentEntryOwner<K extends EntryOwnerKind>(scope: Scope, kind: K, id: string): EntryOwnerTypes[K] | null {
  check(scope, id);
  const value = books.get(scope)?.[kind].get(id);
  return value === undefined || value.owner.disposed || value.owner.disposing ? null : value.value;
}
/** Resolve a row id in one exact owner scope; there is no ambient/global fallback. */
export function entryOwner<K extends EntryOwnerKind>(scope: Scope, kind: K, id: string): EntryOwnerTypes[K] {
  return loan(scope, kind, id).value;
}

/** Resolve only when consumed, then pin that exact publication for this scope.
 * A missing publication may arrive later; a retired or replaced loan refuses. */
export function lateEntryOwner<K extends EntryOwnerKind>(scope: Scope, kind: K, id: string): () => EntryOwnerTypes[K] {
  check(scope, id);
  let original: Loan<EntryOwnerTypes[K]> | undefined;
  return () => {
    const current = loan(scope, kind, id);
    if (original !== undefined && current !== original) throw new Error(`Entry owner changed: ${kind}/${id}`);
    original = current;
    return current.value;
  };
}
