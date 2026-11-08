import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashTree } from './assetHashes';
import { assetIndex } from './gen';
import { WILDSHARD_IDENTITY } from '../../src/client/game/identity';
import { rendererRevision } from '../renderer-revision.mjs';

/** version.json (the build id, written into each document by build-app and never into content-hashed runtime modules, so
 *  the app can tell when the server has a newer build: iOS home-screen PWAs have no address bar, so the title screen
 *  offers the reload), asset-index.json and asset-manifest.json beside the bundle (was vite.config.ts's version plugin): scripts/build-app.mjs writes them right after the bundler, before the documents are stamped from
 *  version.json and before the service worker counts them. */
export function writeVersionFiles(outDir: string, build: string): void {
  const {WILDSHARD_PREPARATION_ONLY} = process.env;
  const epoch: unknown = JSON.parse(readFileSync('save-epoch.json', 'utf8'));
  if (typeof epoch !== 'object' || epoch === null || !('saveEpoch' in epoch) || epoch.saveEpoch !== WILDSHARD_IDENTITY.saveEpoch) throw new Error('Save epoch metadata must match game identity');
  writeFileSync(join(outDir, 'version.json'), JSON.stringify({ build, saveEpoch: epoch.saveEpoch, rendererRevision: rendererRevision(), preparationOnly: WILDSHARD_PREPARATION_ONLY === '1', time: new Date().toISOString() }));
  writeFileSync(join(outDir, 'asset-index.json'), assetIndex());
  writeFileSync(join(outDir, 'asset-manifest.json'), JSON.stringify(hashTree('assets')));
}
