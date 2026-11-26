// J81 ended: @wildshard/format is installed from the shardfile repo, so tools that read its files, rather than
// import them, find them here. Paths stay relative to the repo so a build mirror's linked node_modules works too.
import { resolve } from 'node:path';

export const FORMAT_PACKAGE = 'node_modules/@wildshard/format';
/** A format source or data file. @param {string} root @param {string} file */
export const formatSource = (root, file) => resolve(root, FORMAT_PACKAGE, 'src', 'format', file);
/** Censuses keep format's logical `src/format/x.ts` paths: this is where such a path is on disk.
 * @param {string} root @param {string} path */
export const onDisk = (root, path) => path.startsWith('src/format/') ? formatSource(root, path.slice('src/format/'.length)) : resolve(root, path);
/** Where a layer's package.json and exports live. @param {string} layer */
export const layerFolder = layer => layer === 'format' ? FORMAT_PACKAGE : `src/${layer}`;
