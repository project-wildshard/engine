// oxlint-disable-next-line import/no-nodejs-modules -- Keep these bounded operations' cache inside repository scratch.
import { resolve } from 'node:path';
import { pineGeneration } from './pine-generation';
import { pineBootProgram } from '../../src/shards/pine-hollow/generators/bootProgram';
import { pineGeographyRows } from '../../src/shards/pine-hollow/generators/geographyRows';
import { parseDiscoveryValues, type DiscoveryValues } from '@wildshard/format/discoveryValues';

const geography = pineGeographyRows();
/** The same metadata operations generate(ctx) supplies, without its world, map or output rebuild. */
export const discovery: DiscoveryValues = parseDiscoveryValues({ 'ground.rows': geography.ground, 'forestQueries.rows': geography.forestQueries,
  'pondClip.rows': geography.pondClip, ...await pineBootProgram(pineGeneration('authored-pine-discovery-v1', resolve('tmp/pine-discovery'))) });
