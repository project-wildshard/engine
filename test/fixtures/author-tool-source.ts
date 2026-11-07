// oxlint-disable-next-line import/no-nodejs-modules -- Compare command import edges and root resolution before/after relocation.
import { dirname, relative, resolve } from 'node:path';
import { parseSync } from 'vite';

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected author tool AST node');
  return Object.fromEntries(Object.entries(value));
}

/** Normalize only source locations, import addresses and the verified repository-root expression.
 * Every statement, executable literal, binding, write and browser/physics option remains in the proof. */
export function authorToolProgram(root: string, path: string, source: string): string {
  const file = resolve(root, path);
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean);
    if (typeof value !== 'object' || value === null) return value;
    const node = record(value);
    if (node['type'] === 'ImportDeclaration') {
      const specifier = record(node['source']), spec = specifier['value'];
      if (typeof spec !== 'string') throw new Error('Expected literal author import');
      // J122: the bake tools left the SDK for sharddev; the address changed, the command did not.
      node['source'] = { ...specifier, value: spec.startsWith('.') ? relative(root, resolve(dirname(file), spec)) : spec.replace(/^@wildshard\/sharddev\//u, '@wildshard/engine/host/') };
    }
    if (node['type'] === 'VariableDeclarator' && record(node['id'])['name'] === 'root') {
      const call = record(node['init']), args = call['arguments'];
      if (call['type'] !== 'CallExpression' || record(call['callee'])['name'] !== 'resolve' || !Array.isArray(args) || args.length !== 2) throw new Error('Author root must resolve from its own directory');
      const directory = record(args[0]), meta = record(directory['object']);
      if (directory['type'] !== 'MemberExpression' || record(directory['property'])['name'] !== 'dirname' || meta['type'] !== 'MetaProperty'
        || record(meta['meta'])['name'] !== 'import' || record(meta['property'])['name'] !== 'meta') throw new Error('Author root must start at import.meta.dirname');
      const levels = record(args[1])['value'];
      if (typeof levels !== 'string' || resolve(dirname(file), levels) !== root) throw new Error('Author root differs from the repository');
      node['init'] = { type: 'Literal', value: '<repository-root>' };
    }
    if (node['type'] === 'NewExpression' && record(node['callee'])['name'] === 'URL') {
      const args = node['arguments'];
      if (Array.isArray(args) && args.length === 2) {
        const pathNode = record(args[0]), base = record(args[1]);
        if (pathNode['type'] === 'Literal' && typeof pathNode['value'] === 'string' && pathNode['value'].startsWith('.')
          && base['type'] === 'MemberExpression' && record(base['property'])['name'] === 'url') {
          const meta = record(base['object']);
          if (meta['type'] === 'MetaProperty' && record(meta['meta'])['name'] === 'import' && record(meta['property'])['name'] === 'meta') {
            const address = pathNode['value'];
            node['arguments'] = [{ type: 'Literal', value: relative(root, resolve(dirname(file), address)), directory: address.endsWith('/') }, args[1]];
          }
        }
      }
    }
    return Object.fromEntries(Object.entries(node).filter(([key]) => !['start', 'end', 'loc', 'range', 'raw', 'comments'].includes(key)).map(([key, child]) => [key, clean(child)]));
  };
  return JSON.stringify(clean(parseSync(file, source).program));
}
