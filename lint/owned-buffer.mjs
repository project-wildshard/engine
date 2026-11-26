// ENGINE-MEMORY EM6, design rule 1 (one owner per buffer): count the syntax that makes a big CPU buffer outside the
// helper `src/shared/engine/core/ownedBuffer.ts`, against a shrink-only per-file allowance (lint/owned-buffer-debt.json).
// Syntax only, no types: `new ArrayBuffer(...)` / `new SharedArrayBuffer(...)`; a typed-array constructor with one
// argument that is not an array literal and not a literal length under 64 KB (a sized array, or a copy of another);
// and `<x>.buffer.slice(...)`. A typed array's own `.slice()` cannot be told from an Array's without types, so this
// lint does not count it (the ArrayBuffer census that found those is retired: its wrapped constructors broke three.js).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const OWNED_BUFFER_SCOPE = /^src\/(?:client|shared)\/(?!.*\.test\.ts$)/u;
export const OWNED_BUFFER_HELPER = 'src/shared/engine/core/ownedBuffer.ts';
const BUFFERS = new Set(['ArrayBuffer', 'SharedArrayBuffer']);
const TYPED = new Map([['Int8Array', 1], ['Uint8Array', 1], ['Uint8ClampedArray', 1], ['Int16Array', 2], ['Uint16Array', 2], ['Float16Array', 2], ['Int32Array', 4], ['Uint32Array', 4], ['Float32Array', 4], ['Float64Array', 8], ['BigInt64Array', 8], ['BigUint64Array', 8]]);
const BIG = 65536;

const unwrap = node => ['TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'ChainExpression', 'ParenthesizedExpression', 'TSSatisfiesExpression'].includes(node?.type) ? unwrap(node.expression) : node;
const name = node => { const n = unwrap(node); return n?.type === 'Identifier' ? n.name : n?.type === 'MemberExpression' && !n.computed && ['globalThis', 'window', 'self'].includes(unwrap(n.object)?.name) ? n.property.name : undefined; };

/** Whether one node is a big-buffer site. */
export function bufferSite(node) {
  if (node.type === 'NewExpression') {
    const callee = name(node.callee);
    if (BUFFERS.has(callee)) return true;
    const size = TYPED.get(callee);
    if (size === undefined || node.arguments.length !== 1) return false;
    const arg = unwrap(node.arguments[0]);
    if (arg.type === 'ArrayExpression' || arg.type === 'SpreadElement') return false;
    if (arg.type === 'Literal' && typeof arg.value === 'number') return arg.value * size >= BIG;
    return true;
  }
  if (node.type === 'CallExpression') {
    const callee = unwrap(node.callee);
    if (callee?.type !== 'MemberExpression' || callee.computed || callee.property.name !== 'slice') return false;
    const object = unwrap(callee.object);
    return object?.type === 'MemberExpression' && !object.computed && object.property.name === 'buffer';
  }
  return false;
}

/** Count sites in a parsed program (the ratchet writer and the tests share the rule's test). */
export function bufferSites(program) {
  let count = 0; const stack = [program];
  while (stack.length > 0) {
    const node = stack.pop();
    if (bufferSite(node)) count++;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent') continue;
      if (Array.isArray(value)) { for (const child of value) if (child?.type) stack.push(child); } else if (value?.type) stack.push(value);
    }
  }
  return count;
}

/** The repo-relative path the policy keys on. */
export function bufferPath(filename) {
  const path = filename.replaceAll('\\', '/'), at = path.lastIndexOf('/src/');
  return at === -1 ? path : path.slice(at + 1);
}

export function ownedBufferRule(policyFile) {
  const policy = existsSync(policyFile) ? JSON.parse(readFileSync(policyFile, 'utf8')) : { files: {} };
  return {
    meta: { type: 'problem', docs: { description: 'Make big CPU buffers through ownedBuffer.ts so the ledger names their owner (ENGINE-MEMORY EM6)' }, schema: [] },
    create(context) {
      const file = bufferPath(context.filename);
      if (!OWNED_BUFFER_SCOPE.test(file) || file === OWNED_BUFFER_HELPER) return {};
      const limit = Object.hasOwn(policy.files, file) ? policy.files[file] : 0;
      let found = 0;
      const check = node => { if (bufferSite(node) && ++found > limit) context.report({ node, message: 'OWNED-BUFFER: make this buffer with ownedArray/ownedBuffer/ownedCopy/adoptBuffer (src/shared/engine/core/ownedBuffer.ts) so the memory ledger names its owner; this file has no allowance left (ENGINE-MEMORY EM6)' }); };
      return { NewExpression: check, CallExpression: check };
    },
  };
}

export const OWNED_BUFFER_POLICY = resolve(import.meta.dirname, 'owned-buffer-debt.json');
