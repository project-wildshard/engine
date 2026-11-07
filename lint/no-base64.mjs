// G649 B3: syntactic calls only; no TypeScript program or import-graph walk.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const unwrap = node => ['TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'ChainExpression', 'ParenthesizedExpression'].includes(node?.type)
  ? unwrap(node.expression) : node;
const text = node => {
  const value = unwrap(node);
  return value?.type === 'Literal' && typeof value.value === 'string' ? value.value
    : value?.type === 'TemplateLiteral' && value.expressions.length === 0 ? value.quasis[0]?.value.cooked : undefined;
};
const property = node => node?.type === 'MemberExpression' ? node.computed ? text(node.property) : node.property.name : undefined;
const encoding = value => typeof value === 'string' && /^base64(?:url)?$/iu.test(value);

/** Inspect both ordinary and optional/computed calls. Local constant encodings are settled before reporting. */
export function base64Call(node, constants = new Map(), buffers = new Set(['Buffer']), codecs = new Set(['atob', 'btoa']), factories = new Set()) {
  const callee = unwrap(node.callee);
  const method = callee?.type === 'Identifier' ? callee.name : property(callee);
  if (method === 'atob' || method === 'btoa' || callee?.type === 'Identifier' && codecs.has(method)) return true;
  const factory = callee?.type === 'Identifier' && factories.has(method);
  const argument = unwrap(node.arguments[method === 'from' || factory ? 1 : 0]);
  const encoded = encoding(text(argument)) || argument?.type === 'Identifier' && [...constants.get(argument.name) ?? []].some(encoding);
  if (!encoded) return false;
  if (method === 'toString') return true;
  const owner = unwrap(callee?.object);
  return factory || method === 'from' && (owner?.type === 'Identifier' && buffers.has(owner.name) || property(owner) === 'Buffer');
}

/** Paths in tiny fixtures retain the production layout. */
export function base64Path(filename) {
  const path = filename.replaceAll('\\', '/');
  const at = Math.max(path.lastIndexOf('/src/'), path.lastIndexOf('/scripts/'));
  return at === -1 ? path : path.slice(at + 1);
}

/** One cheap pass collects local constants and calls; the parser already belongs to oxlint. */
export function base64Visitors(check) {
  const constants = new Map(), calls = [], buffers = new Set(['Buffer']), codecs = new Set(['atob', 'btoa']), factories = new Set(), namespaces = new Set();
  const buffer = node => node?.type === 'Identifier' && buffers.has(node.name) || property(node) === 'Buffer';
  const factory = node => node?.type === 'Identifier' && factories.has(node.name) || property(node) === 'from' && buffer(unwrap(node.object));
  return {
    ImportDeclaration(node) {
      if (!['node:buffer', 'buffer'].includes(text(node.source))) return;
      for (const row of node.specifiers) {
        if (row.type === 'ImportNamespaceSpecifier') namespaces.add(row.local.name);
        const name = row.imported?.name ?? text(row.imported);
        if (name === 'Buffer') buffers.add(row.local.name);
        if (name === 'atob' || name === 'btoa') codecs.add(row.local.name);
      }
    },
    VariableDeclarator(node) {
      if (node.id.type === 'Identifier') {
        const value = unwrap(node.init), name = value?.type === 'Identifier' ? value.name : property(value);
        if (buffers.has(name)) buffers.add(node.id.name);
        if (codecs.has(name)) codecs.add(node.id.name);
        if (factory(value)) factories.add(node.id.name);
      } else if (node.id.type === 'ObjectPattern') {
        const value = unwrap(node.init), name = value?.type === 'Identifier' ? value.name : undefined;
        const native = namespaces.has(name) || ['globalThis','window','self'].includes(name);
        for (const row of node.id.properties) {
          if (row.type !== 'Property' || row.value.type !== 'Identifier') continue;
          const key = row.computed ? text(row.key) : row.key.name ?? text(row.key);
          if (native && key === 'Buffer') buffers.add(row.value.name);
          if (native && (key === 'atob' || key === 'btoa')) codecs.add(row.value.name);
          if (buffer(value) && key === 'from') factories.add(row.value.name);
        }
      }
      const value = text(node.init);
      if (node.id.type !== 'Identifier' || value === undefined || node.parent?.kind !== 'const') return;
      const values = constants.get(node.id.name) ?? new Set(); values.add(value); constants.set(node.id.name, values);
    },
    CallExpression(node) { calls.push(node); },
    'Program:exit'() { for (const node of calls) if (base64Call(node, constants, buffers, codecs, factories)) check(node); },
  };
}

/** Count syntax sites in source order with the same visitors as the rule. */
export function base64Sites(program) {
  let count=0;
  const visitor=base64Visitors(()=>count++),stack=[[program,null]];
  while(stack.length>0){
    const [node,parent]=stack.pop();Object.defineProperty(node,'parent',{value:parent,configurable:true});
    visitor[node.type]?.(node);
    const children=[];
    for(const [key,value]of Object.entries(node))if(key!=='parent'){
      if(Array.isArray(value)){for(const child of value)if(child?.type)children.push(child);}
      else if(value?.type)children.push(value);
    }
    for(const child of children.reverse())stack.push([child,node]);
  }
  visitor['Program:exit']();return count;
}

/** The same dedicated policy is checked against immutable predecessors at commit/push. */
export function noBase64Rule(policyFile) {
  const policy = existsSync(policyFile) ? JSON.parse(readFileSync(policyFile, 'utf8')) : { files: {} };
  return {
    meta: { type: 'problem', docs: { description: 'Keep binary content binary; never encode or decode base64 (G649)' },
      schema: [{ type: 'object', properties: { count: { type: 'boolean' } }, additionalProperties: false }] },
    create(context) {
      const file = base64Path(context.filename);
      if (!/^(?:src|scripts)\//u.test(file)) return {};
      const limit = context.options[0]?.count === true ? 0 : Object.hasOwn(policy.files, file) ? policy.files[file] : 0;
      let found = 0;
      return base64Visitors(node => {
        if (++found > limit) context.report({ node, message: 'NO-BASE64: keep bytes in a .bin/.glb file; this file has no remaining base64 allowance (G649)' });
      });
    },
  };
}

export const BASE64_POLICY = resolve(import.meta.dirname, 'base64-debt.json');
