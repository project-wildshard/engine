import * as v from 'valibot';
import { SpeciesSchema, type SpeciesData } from '@wildshard/format/speciesPrograms';
import { nativeBodySchema } from '@wildshard/format/nativePhysics';
import type { AnimalSimSpec } from '@wildshard/engine/entities/AnimalSim';
import type { NativePopulationBootRows, NativePopulationConfig } from '../riding/nativePopulation';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';

/** Optional encounter intake comes from the same admitted species/body book;
 * it adds no initial body, identity or random draw. Ordinary consumers retain
 * their original boot and population rows by identity. */
export interface EncounterIntake {
  readonly species: readonly SpeciesData[];
  readonly recipes: readonly AnimalSimSpec[];
  /** Explicit existing variant-book loans; missing physical recipes only. */
  readonly borrowedKinds?: readonly string[];
  /** Only these admitted always species acquire fixed decision cadence. */
  readonly alwaysKinds?: readonly string[];
  /** These bodies get no motor: their law moves them, and one would stand where they spawned. */
  readonly motorless?: readonly string[];
}
const kinds=v.pipe(v.array(v.pipe(v.string(),v.minLength(1))),v.maxLength(16));
function exact(a:unknown,b:unknown):boolean {
  if(Object.is(a,b))return true;
  if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((value:unknown,index)=>exact(value,b[index]));
  if(a===null||b===null||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)||Array.isArray(b))return false;
  const left=Object.keys(a).sort(),right=Object.keys(b).sort();
  return left.length===right.length&&left.every((key,index)=>key===right[index]&&exact(Reflect.get(a,key),Reflect.get(b,key)));
}
/** A closed body's existing variant declaration may lend only missing native
 * recipes and decisions. Never replace an admitted recipe or population law. */
export function validateEncounterLoans(boot:Pick<NativePopulationBootRows,'species'|'hunt'|'recipes'>,intake:EncounterIntake):void {
  const borrowed=v.parse(kinds,intake.borrowedKinds??[]),always=v.parse(kinds,intake.alwaysKinds??[]);
  if(new Set(borrowed).size!==borrowed.length||new Set(always).size!==always.length)throw new Error('Duplicate native encounter loan');
  for(const kind of borrowed){
    const row=intake.species.find(candidate=>candidate.kind===kind),admitted=boot.species[kind];
    if(row===undefined||admitted===undefined||Object.hasOwn(boot.hunt,kind)
      ||!exact(admitted,{kind:row.kind,variants:row.variants,...(row.spawnOnly===undefined?{}:{spawnOnly:row.spawnOnly})}))
      throw new Error('Native encounter must borrow its exact closed variant book');
  }
  for(const kind of always)if(!intake.species.some(row=>row.kind===kind&&row.tick==='always'))throw new Error('Native always loan differs from its admitted cadence');
  if(intake.recipes.some(row=>boot.recipes.some(admitted=>admitted.kind===row.kind&&admitted.variant===row.variant)))
    throw new Error('Native encounter cannot replace an admitted body recipe');
}

/** Ordinary encounter fixtures keep their exact original driver object. */
export function encounterDriver(driver:NativePopulationConfig['driver'],intake:EncounterIntake):NativePopulationConfig['driver'] {
  if((intake.alwaysKinds?.length??0)===0)return driver;
  return {...driver,alwaysKinds:[...driver.alwaysKinds??[],...intake.alwaysKinds??[]]};
}

function admitEncounters(boot: Parameters<typeof validateEncounterLoans>[0], intake: EncounterIntake): void {
  if (intake.species.length > 16 || intake.recipes.length > 64
    || new Set(intake.species.map(row => row.kind)).size !== intake.species.length
    || intake.species.some(row => Object.hasOwn(boot.species, row.kind) && intake.borrowedKinds?.includes(row.kind) !== true)
    || intake.recipes.some(row => !intake.species.some(species => species.kind === row.kind))
    || new Set(intake.recipes.map(row => `${row.kind}\0${row.variant}`)).size !== intake.recipes.length)
    throw new Error('Native encounter intake duplicates or replaces an admitted population recipe');
  validateEncounterLoans(boot, intake);
  for (const species of intake.species) v.parse(SpeciesSchema, species);
  for (const recipe of intake.recipes) {
    v.parse(nativeBodySchema('axis'), recipe);
    const species = intake.species.find(row => row.kind === recipe.kind);
    if (species === undefined || ![...species.variants, ...species.spawnOnly ?? []].some(row => row.id === recipe.variant))
      throw new Error('Native encounter recipe has no admitted species variant');
  }
}
/** The product with an encounter's species lent into its own boot and population server files: no initial body, identity or draw. */
export async function withEncounters(product: ShardFolder, intake: EncounterIntake): Promise<ShardFolder> {
  const boot = await product.json<NativePopulationBootRows>('server/boot.json'), config = await product.json<NativePopulationConfig>('server/population.json');
  admitEncounters(boot, intake);
  const lent = intake.species.map(row => row.kind), encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
  const files = new Map([['server/boot.json', encode({ ...boot, recipes: [...boot.recipes, ...intake.recipes],
    species: { ...boot.species, ...Object.fromEntries(intake.species.filter(row => !Object.hasOwn(boot.species, row.kind)).map(row => [row.kind, {
      kind: row.kind, variants: row.variants, ...(row.spawnOnly === undefined ? {} : { spawnOnly: row.spawnOnly }) }])) },
    hunt: { ...boot.hunt, ...Object.fromEntries(intake.species.map(row => [row.kind, row])) } })],
    ['server/population.json', encode({ ...config, eliteKinds: [...config.eliteKinds, ...lent], motorKinds: [...config.motorKinds, ...lent.filter(kind => intake.motorless?.includes(kind) !== true)], driver: encounterDriver(config.driver, intake) })]]);
  return { ...product, file: name => { const bytes = files.get(name); return bytes === undefined ? product.file(name) : Promise.resolve(bytes); } };
}
