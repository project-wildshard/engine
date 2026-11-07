import type { LiveGridAdmission } from './live';

/** Prefetch has no world constructor and owns no regional durability registration. */
export type GridAdmissionMetadata = Pick<LiveGridAdmission, 'bytes' | 'exclusiveRuntime' | 'isolatedPreparation' | 'tilePreparation' | 'prepareRuntime' | 'cancel'>;

/** Cached admission keeps metadata only; every world, including re-entry, borrows verified preparation inputs anew. */
export async function preparationAdmission(metadata: () => Promise<GridAdmissionMetadata>, prepare: () => Promise<LiveGridAdmission>): Promise<LiveGridAdmission> {
  const first = await metadata();
  first.cancel?.();
  let generation = 0;
  return {
    bytes: first.bytes,
    ...(first.exclusiveRuntime === undefined ? {} : { exclusiveRuntime: first.exclusiveRuntime }),
    ...(first.isolatedPreparation === undefined ? {} : { isolatedPreparation: first.isolatedPreparation }),
    ...(first.tilePreparation === undefined ? {} : { tilePreparation: first.tilePreparation }),
    ...(first.prepareRuntime === undefined ? {} : { prepareRuntime: first.prepareRuntime }),
    cancel: () => { generation++; },
    create: async (claim, signal) => {
      const current = generation;
      const cancelled = (): boolean => current !== generation || signal?.aborted === true;
      if (cancelled()) throw new Error('Regional preparation cancelled');
      const admission = await prepare();
      try {
        if (cancelled()) throw new Error('Regional preparation cancelled');
        if (first.isolatedPreparation === true && admission.isolatedPreparation !== true) throw new Error('Regional preparation isolation changed');
        const region = await admission.create(claim, signal);
        if (cancelled()) {
          region.dispose(); throw new Error('Regional preparation cancelled');
        }
        return region;
      } catch (error) { admission.cancel?.(); throw error; }
    },
  };
}
