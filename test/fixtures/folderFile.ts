import type { FolderFile, ShardFolderInput } from '@wildshard/engine/game/shardfile/shardFolder';
import { registeredJsonSchema } from '@wildshard/engine/host/formatJsonSchema';
import { validateNamedJsonSchemaPaced } from '../../src/shared/game/shardfile/customSchema';

/** These renderer-free authored fixtures run in Node even with happy-dom's
 * SSR:false. Lend the existing real native validator, never a trusted bypass. */
export const fixtureJsonCheck: NonNullable<ShardFolderInput['jsonCheck']> = validateNamedJsonSchemaPaced;

/** Positive fixture products carry the same defining metadata as real output.
 * Explicit schemas, including deliberate corruptions in negative controls,
 * remain untouched. Payload bytes, hashes and readers are never replaced. */
export function fixtureFolderFile(name: string, file: FolderFile): FolderFile {
  if (file.jsonSchema !== undefined) return file;
  const jsonSchema = registeredJsonSchema(name);
  return jsonSchema === undefined ? file : { ...file, jsonSchema };
}
