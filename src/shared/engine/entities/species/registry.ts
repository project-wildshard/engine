import type { RigContract } from '../../../../client/engine/anim/rig';
import { validateCreatureBones as validateDeclaredBones } from '@wildshard/format/skinData';
import { WeightedTable } from '../../ai/weighted';
import type * as THREE from 'three';
import type { Rng } from '../../core/rng';
import type { DamageRequest } from '../../combat/pipeline';
import type { HuntTuning } from '../../../../server/engine/ai/hunt';
import type { Animal } from '../../../../client/engine/entities/AnimalView';
import type { AnimalSim, AnimalState } from '../AnimalSim';
import type { SpeciesFlight } from '../../ai/flight';

/**
 * Species registry — the pluggable contract every huntable species implements.
 *
 * A species lives in ONE file, `src/engine/entities/species/<kind>.ts`, that ends with `registerSpecies({...})`.
 * `AnimalFactory.ts` imports every file in this folder (`import.meta.glob`, eager) so dropping a new file in
 * is the whole integration: nothing in AnimalFactory / Animal / AnimalManager needs a new `case`.
 * Import the geometry helpers from `./loft` and the types + `registerSpecies` from `./registry` — never
 * from `../AnimalFactory` (that would be an import cycle: the factory imports you).
 *
 * See the header of `src/client/engine/entities/AnimalFactory.ts` for the full contract (coordinates, dims, fur, tints).
 */

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';


/** Per-variant gameplay multipliers, applied by AnimalManager at spawn on top of the species' HuntTuning. */
export interface VariantMods {
  /** × runSpeed / trotSpeed / charge speed (1 = species baseline) */
  speed: number;
  /** × panicDist (the charge trigger) and the "turns on you when hit" distance */
  chargeDist: number;
  /** × damage taken by BODY hits (headshots always land in full) */
  damageTaken: number;
  /** damage dealt to the player by one charge contact (species default 25) */
  chargeDamage: number;
  /** charges last 3× longer, cool down in 1/3 the time, and a hit always provokes one */
  relentless: boolean;
}

export interface VariantDef {
  /** unique within the species, e.g. 'stag', 'black', 'ironhide' (used in HerdPlan.variants and spawn()) */
  id: string;
  /** shown on the health bar / kill feed, e.g. "White stag", "Old Ironhide" */
  label: string;
  /** relative spawn weight inside the species' table (any positive number; the manager normalises) */
  weight: number;
  rarity: Rarity;
  /** uniform mesh scale rolled per individual: [min, max] (1 = the species' modelled size) */
  scale: [number, number];
  /** max hp; omit for the species' HuntTuning.hp */
  hp?: number;
  /** palette overrides for the species' paint function: keys are whatever that species names in its
   *  palette (deer: body, bodyDark, grey, belly, nose…; boar: base, grizzle, dark…), values sRGB 0..1 */
  tint?: Record<string, [number, number, number]>;
  /** fur material overrides (rim glow, emissive, roughness…) merged over the species' FurStyle */
  fur?: Partial<FurStyle>;
  /** free-form knobs the species' build() reads: antlerScale, tuskScale, piebald, scar… */
  traits?: Record<string, number | boolean | string>;
  /** gameplay multipliers (missing keys = 1 / default) */
  mods?: Partial<VariantMods>;
}

export interface AnimalDims {
  /** height of the body bone (spine centre) above ground in the bind pose */
  bodyY: number;
  /** half-length of the body capsule along Z (for hit tests) */
  bodyHalfLen: number;
  /** radius of the body capsule */
  bodyRadius: number;
  /** head hit-sphere radius */
  headRadius: number;
  /** rest length of the front leg (shoulder → hoof) — drives stride frequency */
  legLen: number;
  /** foot rest positions (x, z) per leg FL, FR, BL, BR */
  feet: [number, number][];
  /** width of the body (for the corpse's resting height when rolled on its side) */
  halfWidth: number;
  /** body hit-capsule axis: 'z' (default, along the spine of a quadruped) or 'y' (upright: the Drowned Sailor) */
  capsuleAxis?: 'z' | 'y';
  /** the head ball's centre, head-bone local (model units); default the joint itself. A hull whose skull sits off its head
   *  joint (the Antler King, E350 F-X2) moves the ball onto it */
  headAt?: readonly [number, number, number];
  /** the body capsule's centre, body-bone local (model units; default the joint), and its axis tilted `bodyPitch` rad from
   *  the bone's z toward its y (+ = the front up) — a 'z' capsule only */
  bodyAt?: readonly [number, number, number];
  bodyPitch?: number;
  /** a second body capsule across `bone`'s x axis (the Antler King's shoulders and chest, E350 F-X2): centre (bone local,
   *  model units), half-length along x and radius. Its hits are body hits */
  fore?: { readonly bone: string; readonly at: readonly [number, number, number]; readonly halfLen: number; readonly radius: number };
}

/**
 * Per-frame animation context of a CUSTOM rig (`SpeciesDef.rig === 'custom'`: crab, monkey, sailor — anything that is
 * not a quadruped). Animal.ts hands ONE reused object to `SpeciesDef.animate` every frame instead of running its
 * deer/boar pose generators; the species poses its own bones by name. Timers (deathT, flinch, brace, attack) are
 * owned by Animal.ts so applyDamage / stagger / the corpse contract behave the same as for every other species.
 */
export interface RigAnimCtx {
  bones: Record<string, THREE.Bone>;
  dims: AnimalDims;
  dt: number; t: number; seed: number; scale: number;
  /** m/s forward ground speed and lateral speed (+ = the animal's left) */
  speed: number; strafe: number;
  /** gait phase 0..1, advanced by Animal.ts from the ground speed (stride from dims.legLen) */
  phase: number;
  state: AnimalState;
  alive: boolean;
  /** -1 while alive, else 0..1 over the 0.8 s death collapse (held at 1 afterwards) */
  deathT: number;
  /** 0..1: a hit flinch (decays), the stagger brace (held for the stun), then released */
  flinch: number; brace: number;
  /** 0..1 progress through the current attack (Animal.startAttack), -1 when not attacking */
  attack: number;
  /** where to look (world) and how much, from the AI */
  lookTarget: THREE.Vector3; lookWeight: number;
  /** the animal's world position (feet) and heading */
  position: THREE.Vector3; yaw: number;
  /** per-animal scratch shared with `think` (numbers only: timers, targets, indices) */
  mem: Record<string, number>;
  /** the animal itself (for the few things a pose needs to write back: `yOffset` while climbing / rising) */
  animal: Animal;
}

/**
 * What the shard hands the enemy species' AI (`AnimalManager.enemyWorld`, filled by main.ts / src/shards/driftwood-isle/creatures/Enemies.ts):
 * palm crowns for the monkeys to perch in, the coconut thrower, the wreck's hold for the sailor. Everything optional —
 * a species falls back to ground behaviour when its piece is missing.
 */
export interface EnemyWorld<A extends AnimalSim = Animal> {
  /** palm frond crowns (world) — Coconut Monkey perches — and, index-matched, the foot of each trunk (where it climbs from) */
  perches?: THREE.Vector3[];
  perchBases?: THREE.Vector3[];
  /** lob a coconut from `from` at `target` (Enemies.ts owns the projectile pool + the hit test against the player) */
  throwCoconut?: (from: THREE.Vector3, target: THREE.Vector3, thrower: A) => void;
  /** a splash burst of water droplets at a world point (the sailor rising / dying) */
  splash?: (at: THREE.Vector3, strength: number) => void;
  /** the wreck's hold: centre, radius that counts as "inside" (the player entering it wakes the sailor), the radius the
   *  sailor guards, and the deck / floor height under (x, z) (undefined off the deck → the sand) */
  hold?: { x: number; z: number; r: number; guardR: number; floorAt: (x: number, z: number) => number | undefined };
  /** 0 (midday) .. 1 (night) — the sailor only leaves the hold at night; a shard without a clock leaves it undefined */
  night?: () => number;
}

/** The AI tick (10 Hz) context for a species that thinks for itself (`SpeciesDef.think`): the manager's senses/flee loop is skipped. */
export interface ThinkCtx {
  /** seconds since the last tick (0.1) and the global clock */
  dt: number; t: number;
  /** the player's feet (world) and ground speed m/s */
  player: THREE.Vector3; playerSpeed: number;
  rng: Rng;
  /** dev: the player is invisible to animals */
  calm: boolean;
  /** the herd this animal was spawned into (all members, dead ones too), or null */
  herd: Animal[] | null;
  /** the player takes `damage` from this animal (routed to AnimalManager.onCharge — main.ts already wires it) */
  hurt: (damage: number) => void;
  /** an AnimalSound by name at the animal (routed to AnimalManager.onSound) */
  sound: (name: string) => void;
  /** the shard's enemy pieces (perches, coconuts, the hold) */
  world: EnemyWorld;
  heightAt: (x: number, z: number) => number;
  waterLevel: () => number;
  /** the manager's steering with trunk / edge / slope avoidance (sets the animal's motion) — on a shard that sets
   *  `AnimalManager.navSteer` (Nalati), round what the navmesh walls off */
  steer: (a: Animal, yaw: number, speed: number, turnRate: number) => void;
  /** Air steering: height uses the species' flight.above reference, without ground/nav avoidance. */
  flight: { steer: (a: Animal, yaw: number, speed: number, altitude: number, turnRate?: number) => void };
  /** the heading toward (tx, tz) along the navmesh (the next corner of a path, re-planned when the goal moves > 2 m or
   *  every `every` s); the straight heading without one */
  pathYaw: (a: Animal, tx: number, tz: number, every?: number) => number;
  /** keep inside the chunk and off the water (the manager's confine) */
  confine: (a: Animal) => void;
  /** melee shards: nothing solid (a wall, a beam, a deck, a rock) between it and the player — `hurt` lands only then
   *  (E296); a species asks before it starts a swing it could not land. Always true on a ranged shard */
  reach: (a: Animal) => boolean;
  /** E297 fight rules (`ShardManifest.fight.attackers`, Driftwood): take an attack token before `startAttack` — false = the others
   *  hold them all, so wait (hold back on a ring). The token goes back by itself once the attack is over (attackPhase < 0).
   *  Always true on a shard without the rules */
  claim: (a: Animal) => boolean;
  /** E297: a token is free for it (or it holds one) — false = hold back on the ring instead of closing in. Takes nothing */
  mayAttack: (a: Animal) => boolean;
}

/** Model faces +Z; pos is absolute bind-space, not parent-local (the factory subtracts the parent position). */
export interface BoneDef { name: string; parent: string | null; pos: [number, number, number] }

/** What `SpeciesDef.build()` returns: the un-merged parts of one (kind, variant) model. */
export interface AnimalSpecies {
  bones: BoneDef[];
  /** geometries drawn with the fur material + fur shells (loft() output: has color / skin / furLen attributes) */
  furParts: THREE.BufferGeometry[];
  /** hard parts: hooves, antlers, tusks, snout (no fur shells, vertex colours only) */
  hardParts: THREE.BufferGeometry[];
  /** eye spheres (glossy clearcoat material) */
  eyeParts: THREE.BufferGeometry[];
  dims: AnimalDims;
  /** low-poly style: a base-colour texture on the rig's material (a generated model's own paint, e.g. the Drowned
   *  Captain); the vertex colours multiply it, so textured parts carry white */
  map?: THREE.Texture;
  /** low-poly style: the per-facet lightness jitter (lowpoly.ts facetGeometry, default 0.12) — 0 for a textured model */
  facetJitter?: number;
  /** low-poly style, with `map`: the texture fed back as emissive at this intensity, so a painted model keeps its colours
   *  in shade (the flat toon fill alone left the captain's navy coat near-black) */
  selfLight?: number;
}

/** Fur texture + material look of a species (per-variant overrides via VariantDef.fur). */
export interface FurStyle {
  /** seed + parameters of the tileable strand albedo / normal texture (baked as fur-<kind>-{map,normal}) */
  texSeed: number;
  tex: { contrast: number; grizzle: number; normalStrength: number; bristle: number; strandLen: number; root: number };
  roughness: number;
  sheen: number;
  sheenColor: [number, number, number];
  envMapIntensity: number;
  /** backlit Fresnel tip colour (linear rgb) */
  rim: [number, number, number];
  /** metres the outermost fur shell stands off the skin for furLen = 1 */
  shellLen: number;
  /** metres of noise displacement on the body/neck/head silhouette (shaggy coat); 0 = smooth */
  shag: number;
  /** optional self-glow (linear rgb × intensity) — the Ghost stag uses it */
  emissive?: [number, number, number];
  emissiveIntensity?: number;
}

export interface SpeciesDef {
  flight?: SpeciesFlight;
  /** LOCK / target taps; defaults to false on ground species and true on flight species. */
  lockable?: boolean;
  /** Render contract: procedural generators keep their own timing and gameplay state. */
  rigContract: RigContract;
  /** 'deer' | 'boar' | 'bear' | … — the Animal.kind string, also the HerdPlan.kind */
  kind: string;
  /** default display name when a variant has none */
  label: string;
  /** the weighted variant table; the first entry is the fallback when spawn() is given an unknown id */
  variants: VariantDef[];
  /** variants that are only ever spawned by id (`animals.spawn(kind, x, z, yaw, id)`): never rolled, not in the hunt
   *  tables or the journal — the Antler King's thralls (Pine Hollow PH-M2, species/thrall.ts) */
  spawnOnly?: VariantDef[];
  fur: FurStyle;
  /** build the mesh parts for one variant; called once per (kind, variant) and cached by the factory */
  build: (variant: VariantDef, rng: Rng) => AnimalSpecies;
  /** true = turns on the player (charges) instead of only fleeing (boar, bear) */
  aggressive?: boolean;
  /** s: a charge's readable wind-up on a melee level (default 0.5) */
  chargeWindup?: number;
  /** m: the ring a charger circles on while it waits its turn (default 6.5; a big one a little wider) */
  ringRadius?: number;
  /** m: how wide a track it flattens through trampled grass (default 0.4) */
  trampleRadius?: number;
  /** m/s while wandering (default: 1.1 aggressive / 1.3 not) */
  walkSpeed?: number;
  /** m/s of a charge (default 7.5) */
  chargeSpeed?: number;
  /** damage of one charge contact (default 25) */
  chargeDamage?: number;
  /** the hunting-loop numbers; omit for the manager's DEER_TUNING / BOAR_TUNING (deer / boar keep theirs there) */
  tuning?: HuntTuning;
  /** AnimalSound names for the ambient call and the hurt cry (default deer_call / boar_grunt+boar_squeal);
   *  `callVariants` limits the ambient call to those variant ids (elk: bulls bugle, cows don't) and
   *  `callEvery` is the seconds between calls, [min, max] (default 20–90) */
  sounds?: { call: string; hurt: string; callVariants?: string[]; callEvery?: [number, number] };
  /** animation flavour: grazeNeck 1 = the whole neck goes down (deer), 0.3 = only the nose (boar);
   *  gallopTail 1 = tail flagged straight up when running (deer), 0.5 = half (boar) */
  pose?: { grazeNeck: number; gallopTail: number };
  /** quadruped gait thresholds, m/s at scale 1: the walk → trot blend starts at `trot`, the trot → gallop blend at
   *  `gallop` (default 2.4 / 4.6 — deer-sized; a horse trots to 6.5 m/s before it canters, a wolf trots from 1.8) */
  gait?: { trot: number; gallop: number };
  /** quadruped rigs: called every animated frame AFTER Animal.ts posed the standard bones — layer species-only motion
   *  on top (a horse's mane / tail chain, rearing, a wolf's jaw and howl). Bone rotations Animal.ts sets are rewritten
   *  every frame, so add to them; extra bones are the species' own to set. Same RigAnimCtx the custom rigs get. */
  postPose?: (ctx: RigAnimCtx) => void;
  // ── custom rigs + enemy AI (Driftwood Isle's crab / monkey / sailor; see RigAnimCtx / ThinkCtx above) ──
  /** 'quadruped' (default: the deer skeleton, Animal.ts poses it) or 'custom' (only `body` (root) + `head` bones are
   *  required; `animate` poses the rest every frame) */
  rig?: 'quadruped' | 'custom';
  /** custom rigs: pose the bones from the context (called every frame the animal is within animation range) */
  animate?: (ctx: RigAnimCtx) => void;
  /** Authored cadence; omitted custom thinkers retain their legacy rate during migration. */
  tick?: 'ai' | 'always';
  /** Strike/movement clock, sampled on every scheduled body step before posing. */
  act?: (a: Animal, ctx: ThinkCtx) => void;
  /** The species runs its own decisions on its declared cadence. */
  think?: (a: Animal, ctx: ThinkCtx) => void;
  /** A page's row body of a kind with its own decisions: its strike reads by its attack phase, not a charge. */
  phased?: boolean;
  /** scale the damage of a hit by where it lands: (animal, hitPoint, blow direction) → multiplier (the crab's shell: 0.5 from the front) */
  damageMul?: (a: Animal, hitPoint: THREE.Vector3, dir: THREE.Vector3, request?: DamageRequest) => number;
  /** custom rigs: seconds the corpse stays before it fades on its own (the sailor dissolves into droplets); omit = stays like any carcass */
  corpseFade?: number;
  /** self-lit eyes (linear rgb) × intensity — the Drowned Sailor's cyan stare; the eye material is per species */
  eyeGlow?: [number, number, number]; eyeGlowIntensity?: number;
  /** false = hits draw no blood (stone, ghosts: the balbals and the ghost riders draw their own chips / mist) */
  blood?: boolean;
}

const SPECIES = new Map<string, SpeciesDef>();
let resolveSpecies: ((kind: string) => SpeciesDef | undefined) | undefined;
/** The composition root supplies active, scoped rows; legacy tooling can keep its standalone catalog. */
/** The calls a species with no `sounds` falls back on, by temperament: the composition root installs them (the kit's,
 *  installKitSpecies), so the engine names no creature sound (E405); none installed = silent */
export interface CreatureSoundDefaults { charger: { call: string; hurt: string }; grazer: { call: string; hurt: string } }
let soundDefaults: CreatureSoundDefaults | null = null;
export function setCreatureSoundDefaults(defaults: CreatureSoundDefaults | null): void { soundDefaults = defaults; }
export function creatureSoundDefaults(): CreatureSoundDefaults | null { return soundDefaults; }

export function setSpeciesResolver(resolve: (kind: string) => SpeciesDef | undefined): void { resolveSpecies = resolve; }

/** All creature collision adapters need these bones, including custom and flying rigs. */
export function validateCreatureBones(species: string, names: readonly string[]): void {
  validateDeclaredBones(species, names);
}

/** Register a species (call once at module top level of `species/<kind>.ts`). Re-registering replaces it. */
export function registerSpecies(def: SpeciesDef): SpeciesDef {
  validateCreatureBones(def.kind, def.rigContract.sockets);
  if (def.variants.length === 0) throw new Error(`species '${def.kind}' has no variants`);
  SPECIES.set(def.kind, def);
  return def;
}

export function speciesDef(kind: string): SpeciesDef {
  return resolveSpecies?.(kind) ?? registeredSpecies(kind);
}

export function registeredSpecies(kind: string): SpeciesDef {
  const d = SPECIES.get(kind);
  if (!d) throw new Error(`unknown animal kind '${kind}' (registered: ${[...SPECIES.keys()].join(', ') || 'none'})`);
  return d;
}

export function hasSpecies(kind: string): boolean { return SPECIES.has(kind); }

export function speciesKinds(): string[] { return [...SPECIES.keys()]; }

/** The variant table entry, or the species' first (fallback) variant for an unknown id. */
export function variantDef(kind: string, id: string | undefined): VariantDef { return variantOf(speciesDef(kind), id); }

/** The species fields a variant lookup or roll reads: a registered SpeciesDef and a renderer-free SpeciesRow both satisfy it. */
export type VariantTable = Pick<SpeciesDef, 'kind' | 'variants' | 'spawnOnly'>;
/** `variantDef` over a given species row (a renderer-free host's own rows, not the registry). */
export function variantOf(d: VariantTable, id: string | undefined): VariantDef {
  const first = d.variants[0];
  if (first === undefined) throw new Error(`species '${d.kind}' has no variants`);   // registerSpecies rejects an empty table
  return (id !== undefined && id !== '' ? d.variants.find((v) => v.id === id) ?? d.spawnOnly?.find((v) => v.id === id) : undefined) ?? first;
}

/** Fully-populated gameplay multipliers for a variant (missing keys → 1 / species default). */
export function variantMods(species: Pick<SpeciesDef, 'chargeDamage'>, v: Pick<VariantDef, 'mods'>): VariantMods {
  const m = v.mods ?? {};
  return {
    speed: m.speed ?? 1,
    chargeDist: m.chargeDist ?? 1,
    damageTaken: m.damageTaken ?? 1,
    chargeDamage: m.chargeDamage ?? species.chargeDamage ?? 25,
    relentless: m.relentless ?? false,
  };
}

/**
 * Roll one variant by weight with a seeded Rng. `allowed` restricts the pool to those ids (HerdPlan.variants);
 * `excludeLegendary` re-rolls a legendary into the rare tier (the manager caps legendaries at one alive per kind).
 */
export function rollVariant(species: VariantTable, rng: Rng, allowed?: string[], excludeLegendary = false): VariantDef {
  let pool = allowed !== undefined && allowed.length > 0 ? species.variants.filter((v) => allowed.includes(v.id)) : species.variants;
  if (pool.length === 0) pool = species.variants;
  const pick = (list: VariantDef[]): VariantDef => {
    const row = new WeightedTable({ mode: 'weighted', rows: list.map((v) => ({ item: v, weight: v.weight })) }).pick(undefined, rng.next());
    if (row === null) throw new Error(`species '${species.kind}' has no variants`);
    return row.item;
  };
  let v = pick(pool);
  if (excludeLegendary && v.rarity === 'legendary') {
    const rare = pool.filter((x) => x.rarity === 'rare');
    const rest = pool.filter((x) => x.rarity !== 'legendary');
    v = rare.length > 0 ? pick(rare) : rest.length > 0 ? pick(rest) : v;
  }
  return v;
}
