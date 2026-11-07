// oxlint-disable-next-line import/no-nodejs-modules -- Run production compilers in Node's native Wasm/Response realm.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Preserve native compiler Maps, bytes and signed zero without JSON coercion.
import { deserialize, serialize } from 'node:v8';
import * as v from 'valibot';
import { DecisionScriptsSchema } from '@wildshard/format/decisionScripts';
import { OutputIndexSchema } from '@wildshard/format/outputIndex';
import { ScriptContractSchema } from '@wildshard/format/scriptContract';
import { hashImmutableBytes, encodeCanonicalJson } from '../../src/shared/host/immutable';
import type { ProjectGenerationContext } from '../../src/sharddev/projectGeneration';

const binary = v.instance(Uint8Array);
const file = v.pipe(v.unknown(), v.transform(value => {
  const parsed = v.parse(OutputIndexSchema.entries.files, [value])[0];
  if (parsed === undefined) throw new Error('Missing native compiler file');
  return parsed;
}));
// Validation must not reorder keys: the original producer serializes these
// compiled rows with JSON.stringify, so their property order is byte content.
const orderedRows = v.custom<v.InferOutput<typeof DecisionScriptsSchema>>(value => {
  const checked = v.safeParse(DecisionScriptsSchema, value);
  return checked.success && encodeCanonicalJson(checked.output) === encodeCanonicalJson(value);
});
const decision = v.strictObject({ rows: orderedRows,
  blobs: v.array(v.strictObject({ file, bytes: binary, script: v.exactOptional(ScriptContractSchema) })),
  generated: v.map(v.string(), v.string()), lines: v.number(), ceiling: v.number() });
function native(method: string, args: readonly unknown[]): unknown {
  return deserialize(execFileSync(process.execPath,
    ['--experimental-transform-types', '--import', './scripts/bake-loader.mjs', 'test/fixtures/native-compiler.mjs'],
    { input: serialize({ method, args }), maxBuffer: 1 << 26 }));
}
function rows(method: string, args: readonly unknown[]): v.InferOutput<typeof decision> {
  const result = v.parse(decision, native(method, args));
  for (const blob of result.blobs) if (blob.file.hash !== hashImmutableBytes(blob.bytes) || blob.file.compressed !== blob.bytes.byteLength) throw new Error('Native fixture compiler byte identity differs');
  return result;
}
/** The same injected production capabilities, executed outside happy-dom; every compiler admission guard stays native. */
export const nativeCompilers: Pick<ProjectGenerationContext, 'compileScript' | 'compileScriptV2' | 'compileDecisionRows' | 'compileDecisionScripts'> = {
  compileScript: (...args) => Promise.resolve().then(() => v.parse(binary, native('compileScript', args))),
  compileScriptV2: (...args) => Promise.resolve().then(() => v.parse(binary, native('compileScriptV2', args))),
  compileDecisionRows: (...args) => Promise.resolve().then(() => rows('compileDecisionRows', args)),
  compileDecisionScripts: (...args) => Promise.resolve().then(() => rows('compileDecisionScripts', args)),
};
