// FORMAT-PRUNE FP16b, FP16c and FP16f: Driftwood, Pine and Nalati, from their SDK 0.4.30 pins, ship no native plan file;
// their settings are `server/world` and their hosts' rows are family sections. Tests read a pinned product's plan through
// here, so a pin with no plan file reads as the plan the engine builds for it (`writtenPlan`, `standingHosts`).
import { NATIVE_ASSEMBLY_FILE, type NativeAssemblyPlan } from '@wildshard/format/nativeAssembly';
import { standingHosts } from '../../server/game/shardfile/nativeAssembly';
import type { ShardFolder } from '../../shared/game/shardfile/shardFolder';

const WORLD = 'server/world';
/** The family sections a native world's hosts stand from (`nativeAssembly.ts` HOST_SECTIONS). */
const FAMILIES: ReadonlySet<string> = new Set(['server/quest', 'server/riding', 'server/boss', 'server/patrol']);
interface Sections { has(name: string): boolean; section(name: string): unknown }
const sections = (product: ShardFolder): Sections => product as unknown as Sections;

/** True while a pinned product still ships `server/native-assembly.json` (a writer before FP16b, FP16c and FP16f). */
export function shipsPlanFile(product: ShardFolder): boolean { return product.hasFile(NATIVE_ASSEMBLY_FILE); }

/** The product's plan file, or for a product that ships none, `server/world`'s settings with no feature rows. */
export async function shippedPlan(product: ShardFolder): Promise<NativeAssemblyPlan> {
  if (shipsPlanFile(product)) return JSON.parse(new TextDecoder().decode(await product.file(NATIVE_ASSEMBLY_FILE))) as NativeAssemblyPlan;
  const { version: _version, ...world } = sections(product).section(WORLD) as Readonly<Record<string, unknown>>;
  return { kind: 'native-assembly', ...world, features: [] } as unknown as NativeAssemblyPlan;
}

/** `product` with `plan` as its plan file in place of what it ships: `server/world` and the family sections are hidden, as
 *  a plan file stands for them all (FP21: never both). Its
 *  own fields are the product's (the runtime spreads a product), so `product` must carry its own, as a loaded one does. */
export function withPlanFile(product: ShardFolder, plan: NativeAssemblyPlan): ShardFolder {
  const bytes = new TextEncoder().encode(JSON.stringify(plan));
  return { ...product,
    hasFile: (name: string): boolean => name === NATIVE_ASSEMBLY_FILE || product.hasFile(name),
    file: (name: string) => name === NATIVE_ASSEMBLY_FILE ? Promise.resolve(bytes) : product.file(name),
    has: ((name: string): boolean => name !== WORLD && !FAMILIES.has(name) && sections(product).has(name)) as ShardFolder['has'],
  };
}

/**
 * The product as one plan file naming every host it stands, in install order, with its family sections folded back in:
 * the shape the plan-editing proofs cut and add rows to. A plan file with no family section is the product as shipped.
 * The folded product's own fields are the shipped product's, so a test may spread it.
 */
export async function foldedPlan(product: ShardFolder): Promise<{ readonly product: ShardFolder; readonly plan: NativeAssemblyPlan }> {
  const folds = [...FAMILIES].some(name => sections(product).has(name));
  if (shipsPlanFile(product) && !folds) return { product, plan: await shippedPlan(product) };
  const plan: NativeAssemblyPlan = { ...await shippedPlan(product), features: [...await standingHosts(product)] };
  return { plan, product: withPlanFile(product, plan) };
}
