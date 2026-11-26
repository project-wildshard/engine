// J82: Node refuses to strip types under node_modules, and @wildshard/format ships raw .ts from the shardfile repo (J42).
// This strips our own packages there and nothing else. A script takes it with `--import`, through a loader that imports
// it, or by importing it first and reaching format with `await import()`: a static import links before this module runs.
import { createRequire, registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const OURS = /\/node_modules\/@wildshard\/[^/]+\/.+\.ts$/u;
// Node warns once on first use. Tools read stderr, so take that warning here and leave every later one alone.
// oxlint-disable-next-line typescript/unbound-method -- Held only to put back on the same object.
const { emitWarning } = process;
process.emitWarning = () => undefined;
let nativeTransform = true;
try { stripTypeScriptTypes('', { mode: 'transform' }); }
catch (error) {
  if (!(error instanceof TypeError) || !('code' in error) || error.code !== 'ERR_INVALID_ARG_VALUE') throw error;
  nativeTransform = false; // Node 26 removed transform mode; installed packages still use enums/parameter properties.
} finally { process.emitWarning = emitWarning; }
const require = createRequire(import.meta.url);
let compiler;
/** @param {string} source */
function transform(source) {
  if (nativeTransform) return stripTypeScriptTypes(source, { mode: 'transform' });
  // Meta QA 11-25 row 95: on Node 26 every sim thread required the whole TypeScript compiler here, about 500 ms of each
  // thread's start (worker import 600 ms on 24, 1130 ms on 26), and CI's tape-worker tests passed their fence once every
  // job ran 26. Plain stripping takes every file with no enum or parameter property; only those pay for the compiler.
  try { return stripTypeScriptTypes(source, { mode: 'strip' }); }
  catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') throw error; }
  compiler ??= require('@typescript/typescript6');
  return compiler.transpileModule(source, { compilerOptions: { target: compiler.ScriptTarget.ESNext, module: compiler.ModuleKind.ESNext, verbatimModuleSyntax: true } }).outputText;
}

registerHooks({ load(url, context, next) {
  if (!url.startsWith('file:') || !OURS.test(url)) return next(url, context);
  return { format: 'module', source: transform(readFileSync(fileURLToPath(url), 'utf8')), shortCircuit: true };
} });
