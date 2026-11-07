import Ajv from 'ajv';
import { isJsonData, parseNamedJson } from '@wildshard/format/json';
import { schemaReferences } from './schemaReferences';

/** Named payloads arrive as verified, byte-bounded JSON; their defining schema
 * supplies shape and bounds without introducing a custom-section node limit. */
export function validateNamedJsonSchema(schema: unknown, bytes: Uint8Array): unknown {
  return validateSchema(schema, parseNamedJson(bytes));
}

/** {@link validateNamedJsonSchema} with `pause` between parsing, Ajv setup, compilation and validation: a neighbour's
 *  world hook reading a large named file in play spent 289 ms of one 350 ms frame here (Nine's travel row, 4x CPU). */
export async function validateNamedJsonSchemaPaced(schema: unknown, bytes: Uint8Array, pause: () => Promise<void>): Promise<unknown> {
  const value = parseNamedJson(bytes);
  await pause();
  return pacedChecks(schemaChecks(schema, value), pause);
}

async function pacedChecks(checks: Generator<void, unknown>, pause: () => Promise<void>): Promise<unknown> {
  let result = checks.next();
  while (!result.done) { await pause(); result = checks.next(); }
  return result.value;
}

function validateSchema(schema: unknown, value: unknown): unknown {
  const checks = schemaChecks(schema, value);
  let result = checks.next();
  while (!result.done) result = checks.next();
  return result.value;
}

interface Compiled { readonly validator: Ajv.Ajv; readonly validate: Ajv.ValidateFunction }
/** Compiled validators by schema text, oldest first: every read of a file reuses its schema's compilation (a cold
 *  compile of a 109 KB dressing schema is 17-59 ms on a desktop core), and the bound keeps a long session finite. */
const compiled = new Map<string, Compiled>();
const COMPILED_LIMIT = 256;

function* schemaChecks(schema: unknown, value: unknown): Generator<void, unknown> {
  if (!isJsonData(schema) || typeof schema !== 'object' || schema === null
    || !('$schema' in schema) || schema.$schema !== 'http://json-schema.org/draft-07/schema#') throw new Error('Custom schema requires bounded draft-07 JSON');
  const text = JSON.stringify(schema);
  if (text.length > 1_000_000) throw new Error('Custom schema requires bounded draft-07 JSON');
  let entry = compiled.get(text);
  if (entry === undefined) {
    yield;
    const validator = new Ajv({ allErrors: false, strictKeywords: true, unknownFormats: true, jsonPointers: true, inlineRefs: false });
    yield;
    const validate = validator.compile(schemaReferences(schema, text));
    if (validate.$async === true) throw new Error('Custom schemas cannot be asynchronous');
    entry = { validator, validate };
    compiled.set(text, entry);
    for (const key of compiled.keys()) { if (compiled.size <= COMPILED_LIMIT) break; compiled.delete(key); }
  }
  yield;
  if (entry.validate(value) !== true) throw new Error(`Custom section value refuses its schema: ${entry.validator.errorsText(entry.validate.errors)}`);
  return value;
}
