import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashTree } from './assetHashes';
import { assetIndex } from './gen';

/** version.json (the build id, written into each document by build-app and never into content-hashed runtime modules, so
 *  the app can tell when the server has a newer build: iOS home-screen PWAs have no address bar, so the title screen
 *  offers the reload), asset-index.json and asset-manifest.json beside the bundle (was vite.config.ts's version plugin): scripts/build-app.mjs writes them right after the bundler, before the documents are stamped from
 *  version.json and before the service worker counts them. */
export function writeVersionFiles(outDir: string, build: string): void {
  writeFileSync(join(outDir, 'version.json'), JSON.stringify({ build, time: new Date().toISOString() }));
  writeFileSync(join(outDir, 'asset-index.json'), assetIndex());
  writeFileSync(join(outDir, 'asset-manifest.json'), JSON.stringify(hashTree('assets')));
}
