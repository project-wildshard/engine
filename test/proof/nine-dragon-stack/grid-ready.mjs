import { prepareHeadlessRuntime } from '../../fixtures/nine-headless.ts';
// Plain Node grid admission and durable regional continuation through the same direct native proof factory.
// G972: Nine Dragon Stack permanently occupies (1,-1), including the public grid.
// Read the ordinary checked runtime product; authoring generators need build-only raw imports.
// oxlint-disable-next-line import/no-nodejs-modules -- Native proof reads the admitted local payload inventory.
import { readFileSync } from 'node:fs';
import { builtFolder } from '../../fixtures/builtFolder.ts';
import { loadHeadlessFolder } from '../../../src/server/host/headlessFolder.ts';
import { outputDescriptor } from '../../../src/shared/game/shardfile/outputDescriptor.ts';
import { proveTrustedGridReady } from '../compatibility/gridReady.mjs';

const directory = builtFolder('nine-dragon-stack'), product = await loadHeadlessFolder(directory);
const descriptor = outputDescriptor(product.shardfile);
if (descriptor === undefined) throw new Error('Nine readiness proof requires an admitted output inventory');
const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash,
  Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
console.info(JSON.stringify(await proveTrustedGridReady(product.shardfile, { developer: false, devserver: false }, prepareHeadlessRuntime, assets)));
