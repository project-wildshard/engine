// oxlint-disable-next-line import/no-nodejs-modules -- The native GC child consumes its parent's exact compiled fixture loan.
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import { ReturnProgramSchema } from '@wildshard/format/namedJsonContracts';
import { hashImmutableBytes } from '../../src/shared/host/immutable';

async function roomProgram(): Promise<v.InferOutput<typeof ReturnProgramSchema>> {
  const file = process.env['WS_ARENA_PROGRAM_FILE'], hash = process.env['WS_ARENA_PROGRAM_HASH'];
  if (file === undefined) {
    if (hash !== undefined) throw new Error('Arena program loan lacks its file');
    return (await import('./titanInlineWitness')).titanPrograms.rules;
  }
  if (hash === undefined) throw new Error('Arena program loan lacks its hash');
  const bytes = readFileSync(file);
  if (hashImmutableBytes(bytes) !== hash) throw new Error('Arena program loan hash differs');
  const input: unknown = JSON.parse(bytes.toString('utf8'));
  return v.parse(ReturnProgramSchema, input);
}

/** Same real compiled program in both realms; the GC child never recompiles it. */
export const arenaRoomProgram: v.InferOutput<typeof ReturnProgramSchema> = await roomProgram();
