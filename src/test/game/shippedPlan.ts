// FORMAT-PRUNE FP16b, FP16c and FP16f: Driftwood, Pine and Nalati, from their SDK 0.4.30 pins, ship no native plan file;
// their settings are `server/world` and their hosts' rows are family sections. The plan-move proofs read a pinned
// product's plan through here, so a pin with no plan file reads as the plan the engine builds for it (`writtenPlan`).
import { NATIVE_ASSEMBLY_FILE, type NativeAssemblyPlan } from '@wildshard/format/nativeAssembly';
import type { ShardFolder } from '../../shared/game/shardfile/shardFolder';

const WORLD = 'server/world';
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

/** `product` with `plan` as its plan file in place of what it ships: `server/world` is hidden so the two never meet. */
export function withPlanFile(product: ShardFolder, plan: NativeAssemblyPlan): ShardFolder {
  const bytes = new TextEncoder().encode(JSON.stringify(plan));
  return Object.assign(Object.create(product) as ShardFolder, {
    hasFile: (name: string): boolean => name === NATIVE_ASSEMBLY_FILE || product.hasFile(name),
    file: (name: string) => name === NATIVE_ASSEMBLY_FILE ? Promise.resolve(bytes) : product.file(name),
    has: (name: string): boolean => name !== WORLD && sections(product).has(name),
  });
}
