import { parseWorldScenes, type WorldScenesSection } from '@wildshard/format/worldScenes';
import { isJsonData } from '@wildshard/format/json';
import { TIER } from '@wildshard/engine/core/tier';
import { createModelLibrary, type ModelLibrary } from '../plugin/geometry';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';

/** A world-scene pool library row (format/worldScenes `kind: 'pool'`). */
export type WorldScenePoolRow = Extract<WorldScenesSection['libraries'][number], { readonly kind: 'pool' }>;

/** A tier-selected file name. */
export const tierFile = (file: string | { readonly phone: string; readonly desktop: string }): string => typeof file === 'string' ? file : file[TIER];

/**
 * A world-scene pool library's decoder (createModelLibrary `geometryPools`: each file's parts and Float32 channel renames,
 * its painted models), reading its files through the product's verified reader. The resident world scenes decode a
 * pool whole; the scene catalogue's cold intake passes only the files holding its declared parts (`files`), each with
 * its full parts roster and channel rules.
 */
export function worldScenePool(product: Pick<ShardProduct, 'file' | 'url'>, row: WorldScenePoolRow, selected?: WorldScenePoolRow['files']): ModelLibrary<never, never> {
  // Admit and detach all rows before URL lookup, decoder construction or verified reads.
  const admitted = parseWorldScenes({ version: 1, libraries: [row], materials: [], steps: [] }).libraries[0];
  if (admitted?.kind !== 'pool') throw new Error('Expected a scene pool');
  const full = selected === undefined || selected === row.files;
  if (!full && (!isJsonData(selected) || new Set(selected).size !== selected.length)) throw new Error('Scene pool requires distinct declared files');
  const files = full ? admitted.files : selected.map(file => {
    const index = row.files.indexOf(file), copy = admitted.files[index];
    if (copy === undefined) throw new Error('Scene pool requires declared files');
    return copy;
  });
  const painted = full ? admitted.painted : [];
  return createModelLibrary<never, never>({ meshes: [], meshUrls: {}, hd: [], hdUrls: {}, hdLooks: {}, aoFloor: 1,
    paintedModels: painted.map(model => ({ name: model.id, url: product.url(model.file), geometry: model.geometry })),
    geometryPools: files.map(file => ({ url: product.url(tierFile(file.file)), parts: file.parts, ...(file.channels === undefined ? {} : { channels: file.channels }) })) }, 'world scene library', {},
    async url => {
      const file = [...files.map(entry => tierFile(entry.file)), ...painted.map(entry => entry.file)].find(name => product.url(name) === url);
      if (file === undefined) throw new Error('Missing scene library file');
      const { prepareRigLoader } = await import('@wildshard/engine/anim/rig');
      return (await prepareRigLoader()).createRigLoader().parseBytesAsync(await product.file(file), '');
    });
}
