// oxlint-disable-next-line import/no-nodejs-modules -- Bind discovery to the same declared source/public roots as the CLI.
import { resolve } from 'node:path';
import { createProjectGeneration } from '../../src/sharddev/projectGeneration';
import { nalatiBootProgram } from '../../src/shards/nalati-grasslands/generators/bootProgram';
import { parseDiscoveryValues, type DiscoveryValues } from '@wildshard/format/discoveryValues';

const project = resolve('src/shards/nalati-grasslands');
const context = createProjectGeneration(project, 'f'.repeat(64), new Map(), resolve('tmp/nalati-boot-discovery'), [
  { prefix: '/src/shards/nalati-grasslands/', directory: project },
  { prefix: '/assets/', directory: resolve('public/assets') },
]);

/** The real bounded metadata operation, without rebuilding Nalati's world or output. */
export const discovery: DiscoveryValues = parseDiscoveryValues(await nalatiBootProgram(context));
