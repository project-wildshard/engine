// MEMORY-STRUCTURE STR21 (meta docs/plans/MEMORY-STRUCTURE-PLAN.md, study row 4): a function that runs every frame
// allocates nothing. A function is per-frame when the comment right before it names `@frame` (a JSDoc tag or a
// `// @frame` line). Inside a tagged function's own body the rule counts the syntax that makes garbage each call: a closure
// (an arrow or function expression), an array or object literal, `new`, a spread argument, a template with values, a
// `for ... of` (an iterator), and the array and string methods that return a new array or iterator. A throw's argument is
// exempt (an error path is not the frame). A nested function is one site; its own body is not scanned unless it is tagged.
// Syntax only, no types. Per file, a shrink-only allowance (lint/no-frame-alloc-debt.json) holds what is left: lint fails a
// file over its count, and src/scripts/no-binary-json.mjs refuses a commit that raises one. Rewrite the debt after a cut:
//   node src/scripts/memory/frame-alloc-debt.mjs [--check]
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const FRAME_ALLOC_SCOPE = /^src\/(?:client|shared)\/(?!.*\.test\.ts$)/u;
const TAG = /(?:^|[\s*])@frame\b/u;
/** array and string methods that return a new array, string list or iterator */
const ALLOCATING = new Set(['map', 'filter', 'slice', 'concat', 'flat', 'flatMap', 'splice', 'split', 'keys', 'values', 'entries', 'toSorted', 'toReversed', 'toSpliced']);
/** `Array.from`, `Float32Array.of` ...: the constructors' own copies */
const CONSTRUCTING = new Set(['from', 'of']);

/** A node's start offset (oxc's `start`, ESTree's `range`). @param {any} node */
const startOf = node => node.start ?? node.range?.[0] ?? 0;

/** Whether the comment right before offset `start` (whitespace between) tags what follows `@frame`. Pure.
 * @param {string} text @param {number} start */
export function frameTagged(text, start) {
  let at = start;
  while (at > 0 && /\s/u.test(text[at - 1] ?? '')) at--;
  if (text.slice(at - 2, at) === '*/') {
    const open = text.lastIndexOf('/*', at - 2);
    return open !== -1 && TAG.test(text.slice(open + 2, at - 2));
  }
  const line = text.slice(text.lastIndexOf('\n', at - 1) + 1, at).trim();
  return line.startsWith('//') && TAG.test(line.slice(2));
}

/** @param {any} node */
const isFunction = node => node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression' || node?.type === 'FunctionDeclaration';

/** The function a tag-bearing node declares, or null. @param {any} node @returns {any} */
function declared(node) {
  switch (node.type) {
    case 'FunctionDeclaration': return node;
    case 'MethodDefinition': case 'TSAbstractMethodDefinition': return isFunction(node.value) ? node.value : null;
    case 'PropertyDefinition': case 'Property': return isFunction(node.value) ? node.value : null;
    case 'VariableDeclaration': return isFunction(node.declarations?.[0]?.init) ? node.declarations[0].init : null;
    case 'ExportNamedDeclaration': case 'ExportDefaultDeclaration': return node.declaration ? declared(node.declaration) : null;
    default: return null;
  }
}

/** @param {any} node @returns {string | null} the allocation kind of one node inside a tagged body */
function allocation(node) {
  switch (node.type) {
    case 'ArrowFunctionExpression': case 'FunctionExpression': return 'closure';
    case 'ArrayExpression': return 'array';
    case 'ObjectExpression': return 'object';
    case 'NewExpression': return 'new';
    case 'SpreadElement': return 'spread';
    case 'ForOfStatement': return 'for-of';
    case 'TemplateLiteral': return node.expressions.length > 0 ? 'template' : null;
    case 'CallExpression': {
      const callee = node.callee?.type === 'ChainExpression' ? node.callee.expression : node.callee;
      if (callee?.type !== 'MemberExpression' || callee.computed) return null;
      const method = callee.property?.name, owner = callee.object?.type === 'Identifier' ? callee.object.name : '';
      return ALLOCATING.has(method) || CONSTRUCTING.has(method) && /^(?:Array|Object|\w+Array)$/u.test(owner) ? `${String(method)}()` : null;
    }
    default: return null;
  }
}

/** Every allocation site in `program`'s tagged functions, in source order. Pure.
 * @param {any} program @param {string} text @returns {{start:number, end:number, kind:string}[]} */
export function frameAllocSites(program, text) {
  /** @type {{start:number, end:number, kind:string}[]} */ const sites = [];
  /** @type {Set<any>} */ const tagged = new Set();
  /** @type {any[]} */ const stack = [program];
  while (stack.length > 0) {
    const node = stack.pop();
    const fn = declared(node);
    if (fn !== null && frameTagged(text, startOf(node))) tagged.add(fn);
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent') continue;
      if (Array.isArray(value)) { for (const child of value) if (child?.type) stack.push(child); } else if (value?.type) stack.push(value);
    }
  }
  for (const fn of tagged) {
    /** @type {any[]} */ const body = [fn.body];
    while (body.length > 0) {
      const node = body.pop();
      if (node?.type === 'ThrowStatement') continue;
      const kind = allocation(node);
      if (kind !== null) sites.push({ start: startOf(node), end: node.end ?? node.range?.[1] ?? startOf(node), kind });
      if (isFunction(node)) continue; // one closure; a tagged nested function is scanned as its own
      for (const [key, value] of Object.entries(node)) {
        if (key === 'parent') continue;
        if (Array.isArray(value)) { for (const child of value) if (child?.type) body.push(child); } else if (value?.type) body.push(value);
      }
    }
  }
  return sites.sort((a, b) => a.start - b.start);
}

/** The repo-relative path the policy keys on. @param {string} filename */
export function frameAllocPath(filename) {
  const path = filename.replaceAll('\\', '/'), at = path.lastIndexOf('/src/');
  return at === -1 ? path : path.slice(at + 1);
}

/** @param {string} policyFile */
export function noFrameAllocRule(policyFile) {
  const policy = existsSync(policyFile) ? JSON.parse(readFileSync(policyFile, 'utf8')) : { files: {} };
  return {
    meta: { type: 'problem', docs: { description: 'A per-frame (`@frame`) function allocates nothing (MEMORY-STRUCTURE STR21)' }, schema: [] },
    /** @param {any} context */
    create(context) {
      const file = frameAllocPath(context.filename);
      if (!FRAME_ALLOC_SCOPE.test(file)) return {};
      const limit = Object.hasOwn(policy.files, file) ? policy.files[file] : 0;
      return {
        /** @param {any} program */
        Program(program) {
          const text = context.sourceCode.text, sites = frameAllocSites(program, text);
          for (const site of sites.slice(limit)) {
            context.report({ loc: { start: context.sourceCode.getLocFromIndex(site.start), end: context.sourceCode.getLocFromIndex(site.end) },
              message: `NO-FRAME-ALLOC: a ${site.kind} in an @frame function makes garbage every frame; hoist it to scratch state made once, or move the work off the frame (MEMORY-STRUCTURE STR21; this file has ${String(sites.length)} sites, allowance ${String(limit)} in lint/no-frame-alloc-debt.json)` });
          }
        },
      };
    },
  };
}

export const FRAME_ALLOC_POLICY = resolve(import.meta.dirname, 'no-frame-alloc-debt.json');
