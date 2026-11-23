import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashTree } from './assetHashes';
import { assetIndex } from './gen';
import { WILDSHARD_IDENTITY } from '../../src/client/game/identity';
import { rendererRevision } from '../renderer-revision.mjs';
import { homeGeometryRevision } from '../home-geometry-revision.mjs';
import { engineRelease } from '../changelog.mjs';
import { builtAtOf } from './builtAt.mjs';
import { clientFloor } from './clientFloor';

/** version.json's document for `build`, from the build root's package.json and save-epoch.json. `describe` is the pill's words
 *  (changelog.mjs `engineRelease`): STAGING-BUGBASH SB7, staging v0.1.31's pill read v0.1.31 while version.json, from the raw
 *  `git describe`, said "v0.1.29-153-g5e0fb5efb" because the release's tag did not exist yet when it built. */
export function versionJson(build: string, root: string = process.cwd()): { build: string; clientVersion: string; minClient: string; saveEpoch: typeof WILDSHARD_IDENTITY.saveEpoch; rendererRevision: string; homeGeometryRevision: string; preparationOnly: boolean; time: string; describe: string } {
  const client: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (typeof client !== 'object' || client === null || !('version' in client) || typeof client.version !== 'string') throw new Error('Missing client version');
  const WILDSHARD_PREPARATION_ONLY = process.env['WILDSHARD_PREPARATION_ONLY'];
  const epoch: unknown = JSON.parse(readFileSync(join(root, 'save-epoch.json'), 'utf8'));
  if (typeof epoch !== 'object' || epoch === null || !('saveEpoch' in epoch) || epoch.saveEpoch !== WILDSHARD_IDENTITY.saveEpoch) throw new Error('Save epoch metadata must match game identity');
  return { build, clientVersion: client.version, minClient: clientFloor(client.version), saveEpoch: WILDSHARD_IDENTITY.saveEpoch, rendererRevision: rendererRevision(), homeGeometryRevision: homeGeometryRevision(), preparationOnly: WILDSHARD_PREPARATION_ONLY === '1', time: new Date(Number(builtAtOf(process.env['WS_BUILT_AT']))).toISOString(), describe: engineRelease(root).describe };
}

/** version.json (the build id, written into each document by build-app and never into content-hashed runtime modules, so
 *  the app can tell when the server has a newer build: iOS home-screen PWAs have no address bar, so the title screen
 *  offers the reload), asset-index.json and asset-manifest.json beside the bundle (was vite.config.ts's version plugin): scripts/build-app.mjs writes them right after the bundler, before the documents are stamped from
 *  version.json and before the service worker counts them. */
export function writeVersionFiles(outDir: string, build: string): void {
  writeFileSync(join(outDir, 'version.json'), JSON.stringify(versionJson(build)));
  writeFileSync(join(outDir, 'asset-index.json'), assetIndex());
  writeFileSync(join(outDir, 'asset-manifest.json'), JSON.stringify(hashTree('assets')));
}
