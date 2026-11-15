// oxlint-disable-next-line import/no-unassigned-import -- Install portable Math before simulation modules.
import '../../../shared/engine/core/portableMathFirst';
import {HeadlessSimulation} from '../../../server/host/headless';
import {loadHeadlessProduct} from '../../../server/host/headlessProduct';
import {productHeadlessSections} from '../../../shared/host/headlessSections';
import {outputDescriptor} from '../../../shared/game/shardfile/outputDescriptor';
import {builtProduct} from '../builtProduct';
import {createNativeProofWorker} from '../headlessWorker';
import {admittedProduct} from './admittedProductCache';

export type ProductSimulation = Pick<HeadlessSimulation, 'verbTape' | 'verbTapePart' | 'streamVerbTape' | 'journey' | 'walkLeg' | 'step' | 'dispose' | 'quarantined' | 'checkpoint'>;
export interface ProductSessionOptions {
  /** Trusted proof composition owned by the consumer. Omit to run the product's ordinary native runtime. */
  prepare?: URL;
  snapshot?: string;
}

/** Start replay admission while its caller records native input. A failed
 * admission is observed immediately, even before the caller asks for ready(). */
export async function beginProductSession(slug: string, options: ProductSessionOptions = {}): Promise<{
  ready: () => Promise<ProductSimulation>; assets: ReadonlyMap<string, Uint8Array>;
  product: Awaited<ReturnType<typeof loadHeadlessProduct>>;
}> {
  const directory = builtProduct(slug), {product,assets} = await admittedProduct(directory,'full'), source = product.shardfile;
  if (outputDescriptor(source) === undefined) throw new Error('Missing admitted headless inventory');
  const sections = productHeadlessSections(product);
  const pending = options.prepare === undefined
    ? HeadlessSimulation.create(source, assets, options.snapshot, {deadline: 'advisory', sections, product: directory})
    : createNativeProofWorker(source, assets, options.prepare, {sections, directory, ...(options.snapshot === undefined ? {} : {snapshot: options.snapshot})});
  const outcome = (async () => {try {return {ok: true as const, sim: await pending};} catch (error) {return {ok: false as const, error};}})();
  return {product, assets, ready: async () => {const result = await outcome; if (!result.ok) throw result.error; return result.sim;}};
}

export async function openProductSession(slug: string, options: ProductSessionOptions = {}): Promise<{
  sim: ProductSimulation; product: Awaited<ReturnType<typeof loadHeadlessProduct>>;
}> {
  const session = await beginProductSession(slug, options);
  return {sim: await session.ready(), product: session.product};
}
