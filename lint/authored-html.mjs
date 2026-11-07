// SF58 / G642: only proven static markup, scalar data and exact platform ports
// reach HTML. Use the lint AST and reachable declaration syntax, never a checker.
import { globSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parseSyntaxModule, createSyntaxGraph, syntaxChild as child, syntaxChildren as children, syntaxFunctions as functions } from './syntax-values.mjs';

const sinks = new Set(['innerHTML', 'outerHTML', 'srcdoc']);
const sinkProperties = new Set([...sinks, '__html']);
const indirectCalls = new Set(['call', 'apply']);
const message = 'Authored or unknown runtime text reaches an HTML sink. Put it in textContent beside static platform markup (SF58).';
const unwrap = input => {
  let node = input;
  while (['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression', 'ChainExpression', 'TSInstantiationExpression'].includes(node?.type)) node = node.expression;
  return node;
};
const keyOf = node => node?.type === 'Identifier' ? node.name : node?.type === 'Literal' ? String(node.value) : null;
const domNames = new Set(['Element', 'HTMLElement', 'SVGElement', 'SVGSVGElement', 'HTMLDivElement', 'HTMLSpanElement', 'HTMLButtonElement',
  'HTMLInputElement', 'HTMLIFrameElement', 'HTMLParagraphElement', 'HTMLAnchorElement', 'HTMLStyleElement', 'Document', 'Range']);
const numericMath = new Set(['abs','acos','acosh','asin','asinh','atan','atanh','atan2','cbrt','ceil','clz32','cos','cosh','exp','expm1','floor',
  'fround','hypot','imul','log','log1p','log2','log10','max','min','pow','random','round','sign','sin','sinh','sqrt','tan','tanh','trunc']);
const trusted = new Map([
  ['src/shared/engine/combat/Equipment.ts#WeaponUi.swapIcon', true], ['src/client/engine/ui/hudSlots.ts#DiscOpts.icon', true],
  ['src/client/engine/ui/hudSlots.ts#TouchRelabel.icon', true], ['src/client/engine/input/InputService.ts#TouchVerb.icon', true],
  ['src/client/engine/practice/playground/catalog.ts#PlaygroundCard.icon', true], ['src/shared/engine/app/identity.ts#AppIdentity.wordmark', true],
]);

/** Analyze the supplied oxlint AST; standalone callers parse only their file. */
export function authoredHtmlSites(root, filename, supplied = null) {
  const absolute = resolve(root, filename), file = relative(root, absolute).replaceAll('\\', '/');
  const source = readFileSync(absolute, 'utf8');
  const parsed = supplied === null ? parseSyntaxModule(absolute, source) : null;
  if (parsed && parsed.errors.length > 0) throw new Error(`HTML lint source must parse: ${file}`);
  const program = supplied ?? parsed.program;
  const graph = createSyntaxGraph(root, file, program), { primary, make, values, property, lookup, origins } = graph;
  const calls = [], pending = [], writes = new Map(), sites = new Map();
  const openInterfaces = new Map();
  const identity = ref => ref.node?.type === 'Identifier' ? lookup(ref.unit, ref.node, ref.node.name) : ref.node;
  const global = (ref, name) => ref.node?.type === 'Identifier' && ref.node.name === name && lookup(ref.unit, ref.node, name) === null;
  const isNull = ref => !ref?.node || ref.node.type === 'TSUndefinedKeyword' || ref.node.type === 'TSNullKeyword';
  const memberNames = ref => {
    const node = unwrap(ref.node);
    if (node?.type !== 'MemberExpression') return [];
    return node.computed ? values(child(ref, node.property)).filter(value => value.node.type === 'Literal').map(value => keyOf(value.node)) : [keyOf(node.property)];
  };
  const keepOrigin = (value, ref) => ({ ...value, ownerName: ref.ownerName, member: ref.member });
  const declared = ref => ref.annotation?.node ? values(ref.annotation).map(value => keepOrigin(value, ref)) : [ref];
  function typed(ref, seen = new Set()) {
    const node = unwrap(ref?.node);
    if (!node || seen.has(node)) return [];
    const next = new Set(seen).add(node);
    if (ref.annotation?.node) return values(ref.annotation);
    if (node.type === 'Identifier') {
      const binding = lookup(ref.unit, node, node.name);
      if (binding?.annotation?.node) return values(binding.annotation);
      if (binding?.elementOf) return elements(binding.elementOf);
      if (binding?.function) {
        const call = ref.unit.parents.get(binding.function);
        if (call?.type === 'CallExpression' && call.callee.type === 'MemberExpression' && binding.index === 0
          && ['map','flatMap','forEach','filter','find','some','every'].includes(memberNames(make(ref.unit, call.callee))[0])) return elements(make(ref.unit, call.callee.object));
      }
    }
    if (node.type === 'MemberExpression') return typed(child(ref, node.object), next).flatMap(value => memberNames(ref).flatMap(name => property(value, name, next))).flatMap(declared);
    return values(ref);
  }
  function elements(ref, seen = new Set()) {
    const node = unwrap(ref?.node);
    if (!node || seen.has(node)) return [];
    const next = new Set(seen).add(node);
    if (node.type === 'TSArrayType') return values(child(ref, node.elementType));
    if (node.type === 'TSTypeOperator') return elements(child(ref, node.typeAnnotation), next);
    if (node.type === 'TSTypeAliasDeclaration') return elements(child(ref, node.typeAnnotation), next);
    if (node.type === 'ArrayExpression') return node.elements.flatMap(entry => entry?.type === 'SpreadElement' ? elements(child(ref, entry.argument), next) : entry ? [child(ref, entry)] : []);
    if (node.type === 'TSTypeReference' && ['Array','ReadonlyArray'].includes(keyOf(node.typeName))) return (node.typeArguments?.params ?? []).flatMap(arg => values(child(ref, arg)));
    const initial = origins(ref).filter(value => value.node !== node);
    if (initial.length > 0) {
      const found = initial.flatMap(value => elements(value, next));
      if (found.length > 0) return found;
    }
    return typed(ref).flatMap(value => value.node === node ? [] : elements(value, next));
  }
  function builtinScalar(ref, seen = new Set()) {
    const node = unwrap(ref?.node);
    if (!node || seen.has(node)) return false;
    const next = new Set(seen).add(node);
    if (['TSNumberKeyword','TSBooleanKeyword','TSNullKeyword','TSUndefinedKeyword'].includes(node.type)) return true;
    if (node.type === 'Literal') return !node.regex && (typeof node.value === 'number' || typeof node.value === 'boolean' || node.value === null || ref.literalType === true);
    if (node.type === 'TSTypeAnnotation' || node.type === 'TSTypeAliasDeclaration') return builtinScalar(child(ref, node.typeAnnotation), next);
    if (node.type === 'TSUnionType') return node.types.every(type => builtinScalar(child(ref, type), next));
    if (node.type === 'TSLiteralType') return builtinScalar(child(ref, node.literal), next);
    if (node.type === 'TSTypeOperator' && node.operator === 'keyof') {
      const objects = values(child(ref, node.typeAnnotation));
      return objects.length > 0 && objects.every(value => finiteKeys(value, next));
    }
    return typed(ref).some(value => value.node !== node && builtinScalar(value, next));
  }
  function finiteKeys(ref, seen) {
    const node = ref.node;
    if (!node || seen.has(node)) return false;
    const next = new Set(seen).add(node);
    if (node.type === 'TSTypeAliasDeclaration') {
      const refs = values(child(ref, node.typeAnnotation));
      return refs.length > 0 && refs.every(value => finiteKeys(value, next));
    }
    if (node.type === 'ObjectExpression') return node.properties.every(entry => entry.type === 'Property' && !entry.computed && keyOf(entry.key) !== null);
    if (node.type === 'TSTypeLiteral') return node.members.every(entry => entry.type !== 'TSIndexSignature' && keyOf(entry.key) !== null);
    if (node.type !== 'TSInterfaceDeclaration' || node.extends.length > 0) return false;
    const name = node.id.name;
    if (!openInterfaces.has(name)) {
      // Open interfaces may acquire an index signature through another module.
      // A cheap name-filtered source census refuses that ambiguity; it never
      // builds or asks a compiler for the global program.
      let open = false;
      const pattern = new RegExp(String.raw`\binterface\s+${name.replaceAll('$', String.raw`\$`)}(?:\s|[<{])`, 'u');
      for (const candidate of globSync('src/**/*.{ts,tsx,mts}', { cwd: root })) {
        if (/\.generated\./u.test(candidate)) continue;
        const candidateSource = readFileSync(resolve(root, candidate), 'utf8');
        if (!pattern.test(candidateSource)) continue;
        const result = parseSyntaxModule(resolve(root, candidate), candidateSource);
        if (result.errors.length > 0) { open = true; break; }
        const check = current => {
          if (current.type === 'TSInterfaceDeclaration' && current.id.name === name && (current.extends.length > 0 || current.body.body.some(entry => entry.type === 'TSIndexSignature'))) open = true;
          for (const entry of children(current)) check(entry);
        };
        check(result.program);
      }
      openInterfaces.set(name, open);
    }
    return !openInterfaces.get(name) && node.body.body.every(entry => keyOf(entry.key) !== null);
  }
  function dom(ref, env, seen = new Set()) {
    const node = unwrap(ref?.node);
    if (!node || seen.has(node)) return false;
    const next = new Set(seen).add(node);
    if (node.type === 'Identifier' && env.has(identity(ref))) return env.get(identity(ref)).every(value => dom(value, env, next));
    if (global(ref, 'document')) return true;
    if (node.type === 'TSTypeReference' && domNames.has(keyOf(node.typeName)) && lookup(ref.unit, node, keyOf(node.typeName)) === null) return true;
    if (node.type === 'CallExpression') {
      const callee = unwrap(node.callee), names = memberNames(child(ref, callee));
      if (callee?.type === 'MemberExpression' && names.some(name => ['createElement','createElementNS','querySelector','getElementById','createRange'].includes(name))
        && dom(child(ref, callee.object), env, next)) return true;
    }
    if (node.type === 'MemberExpression' && memberNames(ref).includes('document') && ['window','globalThis'].some(name => global(child(ref, node.object), name))) return true;
    return typed(ref).some(value => value.node !== node && dom(value, env, next));
  }
  function actualRefs(ref, env) {
    const node = unwrap(ref?.node);
    if (node?.type === 'Identifier' && env.has(identity(ref))) return env.get(identity(ref));
    return [ref];
  }
  function argumentsEnv(fn, args, outer) {
    const env = new Map(outer);
    function bind(pattern, refs) {
      if (!pattern) return;
      if (pattern.type === 'Identifier') env.set(lookup(fn.unit, pattern, pattern.name), refs);
      else if (pattern.type === 'AssignmentPattern') bind(pattern.left, refs.every(isNull) ? [child(fn, pattern.right)] : refs);
      else if (pattern.type === 'ObjectPattern') for (const entry of pattern.properties) {
        if (entry.type !== 'RestElement') bind(entry.value, refs.flatMap(ref => actualRefs(ref, outer).flatMap(value => values(value).flatMap(row => property(row, keyOf(entry.key), new Set())))));
      }
      else if (pattern.type === 'ArrayPattern') pattern.elements.forEach((entry, index) => bind(entry, refs.flatMap(ref => actualRefs(ref, outer).flatMap(value => values(value).flatMap(row => property(row, String(index), new Set()))))));
    }
    (fn.node.params ?? []).forEach((param, index) => bind(param, args[index] ?? [child(fn, param.type === 'AssignmentPattern' ? param.right : undefined)]));
    return env;
  }
  function returnExpressions(fn) {
    if (!fn.node.body) return [];
    if (fn.node.body.type !== 'BlockStatement') return [child(fn, fn.node.body)];
    const found = [];
    function collect(node) {
      if (functions.has(node.type) || ['ClassDeclaration','ClassExpression'].includes(node.type)) return;
      if (node.type === 'ReturnStatement') found.push(child(fn, node.argument));
      else for (const entry of children(node)) collect(entry);
    }
    collect(fn.node.body); return found;
  }
  function safe(input, env = new Map(), seen = new Set()) {
    const node = unwrap(input?.node);
    if (!node) return true; // Omitted optional arguments contribute no markup.
    if (seen.has(node) || seen.size > 96) return false;
    const ref = { ...input, node }, next = new Set(seen).add(node);
    const check = value => safe(child(ref, value), env, next);
    const resolved = refs => refs.length > 0 && refs.every(value => safe(value, env, next));
    if (node.type === 'Literal') return typeof node.value !== 'bigint' && !node.regex;
    if (['undefined','NaN','Infinity'].some(name => global(ref, name))) return true;
    if (node.type === 'Identifier' && env.has(identity(ref))) return resolved(env.get(identity(ref)));
    const changed = [identity(ref), ...values(ref).map(value => value.node)].filter(Boolean);
    if (changed.some(key => (writes.get(key) ?? []).some(value => !safe(value, env, next)))) return false;
    if (builtinScalar(ref)) return true;
    if (node.type === 'TemplateLiteral') return node.expressions.every(check);
    if (node.type === 'BinaryExpression') return ['-','*','/','%','**','<<','>>','>>>','&','|','^','<','>','<=','>=','==','===','!=','!==','in','instanceof'].includes(node.operator) || check(node.left) && check(node.right);
    if (node.type === 'UnaryExpression') return ['!','+','-','~','typeof','void'].includes(node.operator);
    if (node.type === 'ConditionalExpression') return check(node.consequent) && check(node.alternate);
    if (node.type === 'LogicalExpression') return check(node.left) && check(node.right);
    if (node.type === 'ArrayExpression') return node.elements.every(entry => entry !== null && check(entry.type === 'SpreadElement' ? entry.argument : entry));
    if (node.type === 'ObjectExpression') return node.properties.every(entry => entry.type === 'Property' && check(entry.value));
    if (node.type === 'Identifier') {
      const binding = lookup(ref.unit, node, node.name);
      if (binding?.elementOf) return resolved(elements(binding.elementOf));
      // A private helper parameter is safe only when every actual caller is safe.
      if (binding?.function) {
        const fn = make(ref.unit, binding.function), index = binding.index;
        if (privateHelper(fn)) {
          const callers = calls.filter(call => values(make(primary, call.callee)).some(value => value.node === fn.node));
          return callers.length > 0 && callers.every(call => safe(make(primary, call.arguments[index] ?? fn.node.params[index]?.right), env, next));
        }
      }
      return resolved(origins(ref).filter(value => value.node !== node));
    }
    if (node.type === 'MemberExpression') {
      const refs = [...typed(ref), ...actualRefs(child(ref, node.object), env).flatMap(value => values(value).flatMap(row => memberNames(ref).flatMap(name => property(row, name, new Set()))))];
      if (refs.some(value => (writes.get(value.node) ?? []).some(write => !safe(write, env, next)))) return false;
      if (refs.length > 0 && refs.every(value => trusted.has(`${value.unit.file}#${value.ownerName}.${value.member}`))) return true;
      if (memberNames(ref).includes('length') && typed(child(ref, node.object)).some(value => value.node.type === 'TSStringKeyword' || value.node.type === 'TSArrayType' || value.node.type === 'TSTupleType')) return true;
      if (memberNames(ref).some(name => ['width','height'].includes(name)) && typed(child(ref, node.object)).some(value => value.node.type === 'TSTypeReference'
        && keyOf(value.node.typeName) === 'HTMLCanvasElement' && lookup(value.unit, value.node, 'HTMLCanvasElement') === null)) return true;
      if (memberNames(ref).includes('innerHTML') && dom(child(ref, node.object), env)) return true;
      if (resolved(refs.map(value => value.initial?.node ? value.initial : value))) return true;
      return safe(child(ref, node.object), env, next); // Lookup in an entirely static table.
    }
    if (node.type === 'CallExpression') {
      if (node.arguments.some(arg => arg.type === 'SpreadElement')) return false;
      const callee = unwrap(node.callee), refs = values(child(ref, callee)), name = memberNames(child(ref, callee))[0];
      if (refs.some(value => value.unit.file === 'src/client/engine/ui/icons.ts' && (value.node.id?.name ?? value.exportName) === 'icon')) return true;
      if (refs.some(value => value.unit.file === 'src/shared/engine/strings.ts' && (value.node.id?.name ?? value.exportName) === 'engineString')) return node.arguments.every(check);
      if (callee.type === 'Identifier' && ['Number','parseInt','parseFloat','Boolean'].some(id => global(child(ref, callee), id))) return true;
      if (global(child(ref, callee), 'String')) return node.arguments.every(check);
      if (callee.type === 'MemberExpression' && global(child(ref, callee.object), 'Math') && numericMath.has(name)) return true;
      if (callee.type === 'MemberExpression' && name === 'length') return false;
      if (callee.type === 'MemberExpression' && ['map','flatMap'].includes(name)) {
        const callbacks = values(child(ref, node.arguments[0])), rows = elements(child(ref, callee.object));
        return callbacks.length > 0 && callbacks.every(fn => {
          const out = returnExpressions(fn), bound = argumentsEnv(fn, [rows], env);
          return rows.length > 0 && out.length > 0 && out.every(value => safe(value, bound, next));
        });
      }
      const typedReturns = refs.flatMap(fn => fn.node.returnType ? values(child(fn, fn.node.returnType)) : []);
      if (typedReturns.length > 0 && typedReturns.every(value => builtinScalar(value))) return true;
      if (refs.length > 0 && refs.every(fn => functions.has(fn.node.type))) return refs.every(fn => {
        const out = returnExpressions(fn), bound = argumentsEnv(fn, node.arguments.map(arg => [child(ref, arg)]), env);
        return out.length > 0 && out.every(value => safe(value, bound, next));
      });
      return callee.type === 'MemberExpression' && safe(child(ref, callee.object), env, next) && node.arguments.every(check);
    }
    return false;
  }
  function privateHelper(fn) {
    const method = fn.unit.parents.get(fn.node);
    if (method?.type === 'MethodDefinition') return method.accessibility === 'private';
    const name = fn.node.id?.name ?? (method?.type === 'VariableDeclarator' ? method.id.name : null);
    if (name && [...fn.unit.exports.values()].some(entry => entry.local === name)) return false;
    for (let parent = fn.node; parent; parent = fn.unit.parents.get(parent)) {
      if (parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportDefaultDeclaration') return false;
      if (['VariableDeclaration','FunctionDeclaration'].includes(parent.type)) return fn.unit.parents.get(parent)?.type !== 'ExportNamedDeclaration';
    }
    return true;
  }
  function target(ref, seen = new Set()) {
    const node = unwrap(ref.node);
    if (!node || seen.has(node)) return [];
    const next = new Set(seen).add(node);
    if (node.type === 'MemberExpression') return [ref];
    if (node.type === 'Identifier') {
      const binding = lookup(ref.unit, node, node.name);
      return (binding?.refs ?? []).flatMap(value => target(value, next));
    }
    if (node.type === 'TSTypeAnnotation') return target(child(ref, node.typeAnnotation), next);
    if (node.type === 'TSTypeQuery') return target(child(ref, node.exprName), next);
    if (node.type === 'CallExpression' && memberNames(child(ref, node.callee)).includes('bind')) return target(child(ref, node.callee.object), next);
    return [];
  }
  function scan(node) {
    const ref = make(primary, node);
    if (node.type === 'CallExpression') {
      calls.push(node);
      const invoked = memberNames(child(ref, node.callee)), forwarding = invoked.some(name => indirectCalls.has(name));
      const callee = forwarding ? node.callee.object : node.callee, targets = target(child(ref, callee)), names = new Set(targets.flatMap(memberNames));
      const args = forwarding ? node.arguments.slice(1) : node.arguments;
      if (names.has('insertAdjacentHTML')) pending.push({ node, value: invoked.includes('apply') ? args[0] : args[1] });
      if (names.has('createContextualFragment') || targets.some(value => memberNames(value).some(name => ['write','writeln'].includes(name)) && dom(child(value, value.node.object), new Map()))) {
        for (const value of args) pending.push({ node, value });
      }
      const object = node.callee.object;
      if (invoked.includes('set') && global(child(ref, object), 'Reflect') && sinks.has(keyOf(args[1]))) pending.push({ node, value: args[2] });
      if (invoked.includes('defineProperty') && global(child(ref, object), 'Object') && sinks.has(keyOf(args[1])) && args[2]?.type === 'ObjectExpression') {
        for (const entry of args[2].properties) if (keyOf(entry.key) === 'value') pending.push({ node, value: entry.value });
      }
    }
    if (node.type === 'AssignmentExpression' && ['=','+='].includes(node.operator)) {
      const left = child(ref, node.left), keys = [identity(left), ...values(left).map(value => value.node)].filter(Boolean);
      for (const key of keys) { const list = writes.get(key) ?? []; list.push(child(ref, node.right)); writes.set(key, list); }
      if (memberNames(left).some(name => sinks.has(name))) pending.push({ node, value: node.right });
    }
    if (node.type === 'Property' && sinkProperties.has(keyOf(node.key))) pending.push({ node, value: node.value });
  }
  // The lexical graph already indexed every primary node in preorder.
  for (const node of primary.parents.keys()) scan(node);
  function record(node) {
    const start = node.start ?? node.range[0], loc = node.loc?.start ?? { line: source.slice(0, start).split('\n').length, column: start - source.lastIndexOf('\n', start - 1) - 1 };
    sites.set(start, { line: loc.line, column: loc.column, message });
  }
  for (const sink of pending) {
    let fn = primary.parents.get(sink.node);
    while (fn && !functions.has(fn.type)) fn = primary.parents.get(fn);
    const helper = fn ? make(primary, fn) : null;
    const callers = helper && privateHelper(helper) ? calls.filter(call => values(make(primary, call.callee)).some(value => value.node === fn)) : [];
    if (callers.length === 0) { if (!safe(make(primary, sink.value))) record(sink.node); continue; }
    for (const call of callers) {
      if (call.arguments.some(arg => arg.type === 'SpreadElement') || fn.params.some(param => param.type === 'RestElement')) { record(call); continue; }
      const env = argumentsEnv(helper, call.arguments.map(arg => [make(primary, arg)]), new Map());
      if (!safe(make(primary, sink.value), env)) record(call);
    }
  }
  return [...sites.values()].sort((a, b) => a.line - b.line || a.column - b.column);
}
