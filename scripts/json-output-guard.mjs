// G649 B2: every shared JSON write enforces the same exact-path policy as the gates.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { isAnyArrayBuffer } from 'node:util/types';
import { BINARY_JSON_POLICY, binaryJsonPolicy, binaryJsonValue, binaryJsonValueFailures } from './no-binary-json.mjs';

/** Reject byte views before JSON.stringify silently turns them into numeric objects.
 * Ordinary authored numeric rows keep their meaning; explicit Buffer JSON is binary too.
 * Native buffer brands also cover values returned from an isolated VM realm.
 * @param {unknown} value @param {string} [path] */
export function assertJsonRows(value, path = '<JSON value>') {
  const pending = [value], seen = new WeakSet();
  while (pending.length > 0) {
    const row = pending.pop();
    if (row === null || typeof row !== 'object') continue;
    if (row instanceof ArrayBuffer || row instanceof SharedArrayBuffer || isAnyArrayBuffer(row) || ArrayBuffer.isView(row)
      || (Reflect.get(row, 'type') === 'Buffer' && Array.isArray(Reflect.get(row, 'data'))))
      throw new Error(`BINARY-JSON ${path}: byte values require a separate binary file`);
    if (seen.has(row)) continue; seen.add(row);
    for (const next of Object.values(row)) pending.push(next);
  }
}

/** An isolated job needs allowances only for its declared output paths. Parse
 * the full source policy first; omission never grants debt to another output.
 * @param {string} directory @param {readonly string[]} outputs */
export function jsonOutputPolicy(directory,outputs) {
  const file=resolve(directory,BINARY_JSON_POLICY);
  if(!existsSync(file))return undefined;
  const policy=binaryJsonPolicy(JSON.parse(readFileSync(file,'utf8'))),wanted=new Set(outputs);
  return JSON.stringify({...policy,files:Object.fromEntries(Object.entries(policy.files).filter(([path])=>wanted.has(path)))});
}

/** A producer's immutable sandbox supplies its policy as a keyed source input.
 * Absent policy means zero debt, so an isolated author fixture cannot grant itself binary JSON.
 * @param {string} [directory] @returns {(file:string,bytes:Uint8Array|string)=>void} */
export function jsonOutputGuard(directory = process.cwd()) {
  const root = resolve(directory), policyFile = resolve(root, BINARY_JSON_POLICY);
  const policy = binaryJsonPolicy(existsSync(policyFile) ? JSON.parse(readFileSync(policyFile, 'utf8'))
    : { schema: 'no-binary-json/1', source: '0'.repeat(40), files: {} });
  return (file, bytes) => {
    if (!file.endsWith('.json')) return;
    const path = relative(root, resolve(root, file));
    if (isAbsolute(path) || path.startsWith('../') || path.includes('\\')) throw new Error(`BINARY-JSON ${file}: output escapes its producer`);
    const value = binaryJsonValue(typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    assertJsonRows(value, path);
    const failures = binaryJsonValueFailures(path, value, policy);
    if (failures.length > 0) throw new Error(failures.join('\n'));
  };
}
