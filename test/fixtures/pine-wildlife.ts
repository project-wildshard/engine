import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pineBirds } from '../../src/shards/pine-hollow/generators/birdInputs';
import { wildlifeDraw } from '../../src/shards/pine-hollow/generators/wildlifeDraw';
import { pineGeneration } from './pine-generation';

/** The actual bird producer's admitted rest ranges, without unrelated script compilation in DOM tests. */
const context = pineGeneration('pine-wildlife-fixture-v1', resolve(homedir(), '.cache/wildshard/gen'));
export const PINE_WILDLIFE_DRAW: ReturnType<typeof wildlifeDraw> = wildlifeDraw((await pineBirds(context)).ranges);
