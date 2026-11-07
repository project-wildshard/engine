// J82: Node refuses to strip types under node_modules, and @wildshard/format ships raw .ts from the shardfile repo (J42).
// This strips our own packages there and nothing else. A script takes it with `--import`, through a loader that imports
// it, or by importing it first and reaching format with `await import()`: a static import links before this module runs.
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const OURS = /\/node_modules\/@wildshard\/[^/]+\/.+\.ts$/u;
// Node warns once on first use. Tools read stderr, so take that warning here and leave every later one alone.
// oxlint-disable-next-line typescript/unbound-method -- Held only to put back on the same object.
const { emitWarning } = process;
process.emitWarning = () => undefined;
stripTypeScriptTypes('');
process.emitWarning = emitWarning;

registerHooks({ load(url, context, next) {
  if (!url.startsWith('file:') || !OURS.test(url)) return next(url, context);
  return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
} });
