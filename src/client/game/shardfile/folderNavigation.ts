import { installNavigationReader } from '@wildshard/engine/physics/navmeshLoad';
import { slugRuntimeFolder } from './runtimeFolder';
import { standaloneHybrid } from './folderGround';

/**
 * The game session's navigation reader (E434: `startSession` installs it beside `installFolderGround`). A level's declared
 * navigation (`loadNavmesh`, keyed by its baked id) whose shard's admitted product declares the same WSNM row file is read
 * from that product: a grid cell's admitted bytes, or standalone, ahead of the hybrid boot, the canonical product (its
 * descriptor shared with that boot, the file cached for its admission). The page never downloads the same navigation as
 * the manifest's `navmesh.bin` URL too. Any other key, or a product declaring another file, keeps the engine's fetch.
 * Returns the restore.
 */
export function installFolderNavigation(): () => void {
  return installNavigationReader(({ key, file }) => {
    const resident = slugRuntimeFolder(key), pending = resident === null ? standaloneHybrid(key) : Promise.resolve(resident);
    return pending === null ? null : pending.then(product => product.source.navigation?.file === file ? product.assets.read(file) : null);
  });
}
