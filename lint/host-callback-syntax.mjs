// G642: callback admission from syntax; the typed catalogue is a separate build tool.
import { hostPlayFile } from './host-files.mjs';
import { createSyntaxGraph, syntaxChild as child,
  syntaxFunctions as functions, syntaxClasses as classes } from './syntax-values.mjs';

const platform = file => /^src\/(?:engine|game|sdk|sharddev)\//u.test(file);
const shard = file => file.startsWith('src/shards/');
const keyOf = node => node?.type === 'Identifier' ? node.name : node?.type === 'Literal' ? String(node.value) : null;
const unwrap = input => {
  let node = input;
  while (['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression', 'ChainExpression', 'TSInstantiationExpression'].includes(node?.type)) node = node.expression;
  return node;
};

/** Follow syntax reachable from the supplied lint AST, never a TypeScript program. */
export function hostCallbackSites(root, file, program) {
  if (!hostPlayFile(root, file)) return [];
  const { primary, make, values } = createSyntaxGraph(root, file, program);
  function leaves(ref, label, seen = new Set()) {
    const node = unwrap(ref.node);
    if (!node || seen.has(node)) return [];
    const next = new Set(seen).add(node), { unit } = ref;
    if (functions.has(node.type)) return [label];
    if (node.type === 'ConditionalExpression') return [...leaves(child(ref, node.consequent), `${label}.true`, next), ...leaves(child(ref, node.alternate), `${label}.false`, next)];
    if (node.type === 'ObjectExpression') return node.properties.flatMap(entry => entry.type === 'SpreadElement' ? leaves(child(ref, entry.argument), `${label}.*`, next)
      : leaves(child(ref, entry.value), `${label}.${keyOf(entry.key)}`, next));
    if (node.type === 'ArrayExpression') return node.elements.flatMap((entry, index) => leaves(child(ref, entry?.type === 'SpreadElement' ? entry.argument : entry), `${label}[${index}]`, next));
    // Follow shard-authored value/type bags, but do not expand an opaque
    // platform service into every callback-shaped method on its prototype.
    if (node.type === 'TSInterfaceDeclaration' || node.type === 'TSTypeLiteral') {
      if (!shard(unit.file)) return [];
      const members = node.type === 'TSTypeLiteral' ? node.members : node.body.body;
      return members.flatMap(entry => entry.type === 'TSCallSignatureDeclaration' ? [label]
        : leaves(child(ref, entry.type === 'TSMethodSignature' ? entry : entry.typeAnnotation), `${label}.${keyOf(entry.key)}`, next));
    }
    if (node.type === 'TSTypeAliasDeclaration') return leaves(child(ref, node.typeAnnotation), label, next);
    if (classes.has(node.type)) return [];
    return values(ref).flatMap(value => value.node === node ? [] : leaves(value, label, next));
  }
  const issues = [];
  function visit(node) {
    if (['CallExpression', 'NewExpression'].includes(node.type)) {
      const callee = unwrap(node.callee), indirect = callee.type === 'MemberExpression' && ['call', 'apply', 'bind'].includes(keyOf(callee.property));
      const hosts = values(make(primary, indirect ? callee.object : callee)).filter(ref => platform(ref.unit.file)
        && (functions.has(ref.node.type) || node.type === 'NewExpression' && classes.has(ref.node.type)));
      const identities = new Set();
      for (const ref of hosts) {
        const host = { module: ref.unit.file, export: ref.ownerName ?? ref.exportName ?? ref.node.id?.name ?? 'default', ...(ref.member ? { member: ref.member } : {}) };
        const identity = JSON.stringify(host);
        if (identities.has(identity)) continue;
        identities.add(identity);
        for (const [index, argument] of node.arguments.entries()) {
          if (indirect && index === 0) continue;
          for (const path of new Set(leaves(make(primary, argument), `arg${index}`))) issues.push({ ...host, file, start: argument.start ?? argument.range[0], end: argument.end ?? argument.range[1], path,
            message: `Shard TS callback ${path} crosses ${host.module}#${host.export}${host.member ? `.${host.member}` : ''}; pass data or a Wasm reference (G454)` });
        }
      }
    }
  }
  for (const node of primary.parents.keys()) visit(node);
  return issues;
}
