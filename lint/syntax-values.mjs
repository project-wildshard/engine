// G642: shared lexical values for syntax-only lint rules; no compiler/checker.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parseSync } from 'vite';

export const syntaxFunctions = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'TSDeclareFunction',
  'TSFunctionType', 'TSMethodSignature', 'TSCallSignatureDeclaration']);
export const syntaxClasses = new Set(['ClassDeclaration', 'ClassExpression']);
const unwrap = input => {
  let node = input;
  while (['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression', 'ChainExpression', 'TSInstantiationExpression'].includes(node?.type)) node = node.expression;
  return node;
};
const decorate = (ref, extra) => ({ ...ref, ...extra });
export const syntaxChild = (ref, node) => ({ unit: ref.unit, node, ...(ref.types ? { types: ref.types } : {}) });
const keyOf = node => node?.type === 'Identifier' ? node.name : node?.type === 'Literal' ? String(node.value) : null;
const metadataKeys = new Set(['parent', 'loc', 'range', 'tokens', 'comments']);
export const syntaxChildren = node => {
  const children = [];
  for (const key of Object.keys(node)) {
    if (metadataKeys.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item.type === 'string') children.push(item);
    } else if (value && typeof value.type === 'string') children.push(value);
  }
  return children;
};
const parsedModules = new Map();

// Shared by provenance graphs and their declaration census. Current bytes are
// always supplied by the caller; changed bytes replace both AST and scopes.
export function parseSyntaxModule(filename, text) {
  const cached = parsedModules.get(filename);
  if (cached?.text === text) return cached;
  const parsed = parseSync(filename, text);
  const entry = { text, program: parsed.program, errors: parsed.errors, units: new Map() };
  parsedModules.set(filename, entry);
  return entry;
}


function moduleFile(root, from, source) {
  let path;
  if (source.startsWith('.')) path = resolve(root, dirname(from), source);
  else if (source.startsWith('/src/')) path = resolve(root, source.slice(1));
  else {
    const pkg = /^@wildshard\/(engine|game|sdk|sharddev|format)\/(.+)$/u.exec(source);
    if (!pkg) return null;
    const manifest = resolve(root, 'package.json');
    const exports = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).exports ?? {} : {};
    let target = exports[`./${pkg[2]}`];
    while (target && typeof target === 'object') target = target.types ?? target.import ?? target.default;
    path = resolve(root, typeof target === 'string' ? target : pkg[2]);
  }
  const sourcePath = /\.[cm]?js$/u.test(path) ? path.replace(/\.js$/u, '.ts').replace(/\.mjs$/u, '.mts').replace(/\.cjs$/u, '.cts') : path;
  for (const candidate of [path, sourcePath, ...['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.d.ts'].map(ext => path + ext)]) {
    if (/\.[cm]?[jt]sx?$/u.test(candidate) && existsSync(candidate)) return relative(root, candidate).replaceAll('\\', '/');
  }
  return null;
}

// Bindings are lexical, not a file-wide name table: a local host or parameter
// must never accidentally resolve to an import with the same spelling.
function syntaxUnit(file, program) {
  const unit = { file, program, scopes: new Map(), parents: new Map(), exports: new Map(), stars: [], scope: null };
  const scope = { parent: null, names: new Map(), node: program };
  unit.scope = scope;
  const ref = (node, extra = {}) => ({ unit, node, ...extra });
  function bind(pattern, value, current, path = []) {
    if (!pattern) return;
    if (pattern.type === 'Identifier') current.names.set(pattern.name, { ...value, path });
    else if (pattern.type === 'AssignmentPattern') bind(pattern.left, value, current, path);
    else if (pattern.type === 'RestElement') bind(pattern.argument, value, current, path);
    else if (pattern.type === 'ObjectPattern') for (const property of pattern.properties) {
      bind(property.value ?? property.argument, value, current, [...path, keyOf(property.key)]);
    }
    else if (pattern.type === 'ArrayPattern') pattern.elements.forEach((entry, index) => bind(entry, value, current, [...path, String(index)]));
  }
  function walk(node, current, parent = null) {
    if (!node) return;
    unit.parents.set(node, parent);
    if (['FunctionDeclaration', 'TSDeclareFunction', 'ClassDeclaration', 'TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration'].includes(node.type) && node.id) {
      bind(node.id, { refs: [ref(node)] }, current);
    }
    let active = current;
    if (syntaxFunctions.has(node.type) || syntaxClasses.has(node.type) || ['TSTypeAliasDeclaration', 'TSInterfaceDeclaration', 'BlockStatement', 'CatchClause', 'ForStatement', 'ForOfStatement', 'ForInStatement'].includes(node.type)) {
      active = { parent: current, names: new Map(), node };
      if (node.id) bind(node.id, { refs: [ref(node)] }, active);
      for (const [index, input] of (node.params ?? []).entries()) {
        const param = input.type === 'TSParameterProperty' ? input.parameter : input;
        bind(param, { refs: [ref(param.typeAnnotation ?? param.left?.typeAnnotation ?? param.right)], annotation: ref(param.typeAnnotation ?? param.left?.typeAnnotation),
          parameter: param, function: node, index }, active);
      }
      if (node.type === 'CatchClause') bind(node.param, { refs: [] }, active);
      for (const param of node.typeParameters?.params ?? []) bind(param.name, { refs: [ref(param.constraint ?? param.default)] }, active);
    }
    unit.scopes.set(node, active);
    if (node.type === 'ImportDeclaration') for (const spec of node.specifiers) bind(spec.local,
      { source: node.source.value, imported: spec.type === 'ImportNamespaceSpecifier' ? '*' : spec.type === 'ImportDefaultSpecifier' ? 'default' : keyOf(spec.imported) }, active);
    if (node.type === 'VariableDeclarator') {
      let target = active;
      if (parent?.kind === 'var') while (target.parent && !syntaxFunctions.has(target.node.type) && target.node.type !== 'Program') target = target.parent;
      const loop = unit.parents.get(parent);
      bind(node.id, { refs: [ref(node.init ?? node.id.typeAnnotation)], annotation: ref(node.id.typeAnnotation),
        ...(loop?.type === 'ForOfStatement' ? { elementOf: ref(loop.right) } : {}) }, target);
    }
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration?.id) unit.exports.set(keyOf(node.declaration.id), { local: keyOf(node.declaration.id) });
      for (const declaration of node.declaration?.declarations ?? []) if (declaration.id.type === 'Identifier') unit.exports.set(declaration.id.name, { local: declaration.id.name });
      for (const spec of node.specifiers) unit.exports.set(keyOf(spec.exported), node.source ? { source: node.source.value, imported: keyOf(spec.local) } : { local: keyOf(spec.local) });
    }
    if (node.type === 'ExportDefaultDeclaration') unit.exports.set('default', { refs: [ref(node.declaration)] });
    if (node.type === 'ExportAllDeclaration') unit.stars.push(node.source.value);
    for (const entry of syntaxChildren(node)) walk(entry, active, node);
  }
  walk(program, scope);
  return unit;
}

/** Follow only syntax reachable from the current file. No TypeScript program,
 * checker, emit, source-tree glob or generated catalogue is loaded here. */
export function createSyntaxGraph(root, file, program) {
  const units = new Map(), primary = syntaxUnit(file, program);
  // Repeated lexical references to one import share its successful lookup in
  // this synchronous analysis only. A new analysis rechecks package exports
  // and path priority; missing probes are never memoized, even within a pass.
  const resolvedTargets = new Map();
  const targetFor = (from, source) => {
    const key = `${from}\0${source}`;
    if (resolvedTargets.has(key)) return resolvedTargets.get(key);
    const target = moduleFile(root, from, source);
    if (target !== null) resolvedTargets.set(key, target);
    return target;
  };
  units.set(file, primary);
  function load(target) {
    if (target === null) return null;
    if (units.has(target)) return units.get(target);
    const absolute = resolve(root, target), text = readFileSync(absolute, 'utf8');
    const entry = parseSyntaxModule(absolute, text);
    if (entry.errors.length > 0) throw new Error(`Syntax dependency must parse: ${target}`);
    const ast = entry.program;
    // Never retain oxlint's supplied primary AST; only dependency-owned scopes.
    const key = `${root}\0${target}`;
    let unit = entry.units.get(key);
    if (unit === undefined) { unit = syntaxUnit(target, ast); entry.units.set(key, unit); }
    units.set(target, unit);
    return unit;
  }
  const make = (unit, node, extra = {}) => ({ unit, node, ...extra });
  function lookup(unit, node, name) {
    for (let scope = unit.scopes.get(node) ?? unit.scope; scope; scope = scope.parent) if (scope.names.has(name)) return scope.names.get(name);
    return null;
  }
  function binding(unit, value, seen) {
    if (!value) return [];
    let refs;
    if (value.source) {
      const other = load(targetFor(unit.file, value.source));
      refs = other === null ? [] : value.imported === '*' ? [make(other, other.program, { namespace: true })] : exported(other, value.imported, seen);
    } else if (value.local) return binding(unit, unit.scope.names.get(value.local), seen);
    else refs = (value.refs ?? []).flatMap(ref => values(ref, seen));
    for (const name of value.path ?? []) refs = refs.flatMap(ref => property(ref, name, seen));
    return refs;
  }
  function exported(unit, name, seen) {
    const marker = `${unit.file}#${name}`;
    if (seen.has(marker)) return [];
    const next = new Set(seen).add(marker), own = unit.exports.get(name);
    if (own) return binding(unit, own, next).map(ref => decorate(ref, { exportName: ref.exportName ?? name }));
    return unit.stars.flatMap(source => {
      const other = load(targetFor(unit.file, source));
      return other === null ? [] : exported(other, name, next);
    });
  }
  function property(ref, name, seen) {
    if (name === null || !ref.node) return [];
    const { node, unit } = ref;
    if (ref.namespace) return exported(unit, name, seen);
    if (node.type === 'TSTypeAliasDeclaration') return values(syntaxChild(ref, node.typeAnnotation), seen).flatMap(value => property(value, name, seen));
    if (node.type === 'TSTypeOperator') return values(syntaxChild(ref, node.typeAnnotation), seen).flatMap(value => property(value, name, seen));
    if (node.type === 'TSArrayType' && /^\d+$/u.test(name)) return values(syntaxChild(ref, node.elementType), seen);
    if (node.type === 'TSTupleType' && /^\d+$/u.test(name)) return values(syntaxChild(ref, node.elementTypes[Number(name)]), seen);
    if (node.type === 'TSTypeReference' && /^\d+$/u.test(name) && ['Array', 'ReadonlyArray'].includes(keyOf(node.typeName))) return values(syntaxChild(ref, node.typeArguments?.params[0]), seen);
    if (node.type === 'ObjectExpression') {
      const out = [];
      for (const entry of node.properties) {
        if (entry.type === 'SpreadElement') out.push(...values(syntaxChild(ref, entry.argument), seen).flatMap(value => property(value, name, seen)));
        else if (keyOf(entry.key) === name) out.push(...values(syntaxChild(ref, entry.value), seen).map(value => decorate(value, { initial: syntaxChild(ref, entry.value) })));
      }
      return out;
    }
    if (node.type === 'ArrayExpression') return values(syntaxChild(ref, node.elements[Number(name)]), seen);
    const members = syntaxClasses.has(node.type) ? node.body.body : node.type === 'TSInterfaceDeclaration' ? node.body.body : node.type === 'TSTypeLiteral' ? node.members : [];
    const own = members.filter(entry => keyOf(entry.key) === name).flatMap(entry => {
      const member = make(unit, entry.value ?? entry.typeAnnotation ?? entry, { ownerName: ref.exportName ?? node.id?.name, member: name, types: ref.types, annotation: syntaxChild(ref, entry.typeAnnotation) });
      return (entry.kind === 'get' ? returns(member, seen) : values(member, seen)).map(value => decorate(value,
        { ownerName: member.ownerName ?? value.ownerName, member: name, annotation: member.annotation, initial: syntaxChild(ref, entry.value) }));
    });
    if (own.length > 0) return own;
    if (syntaxClasses.has(node.type)) {
      const constructor = node.body.body.find(entry => entry.kind === 'constructor');
      const parameter = constructor?.value.params.find(entry => entry.type === 'TSParameterProperty' && keyOf(entry.parameter) === name);
      if (parameter) return values(make(unit, parameter.parameter.typeAnnotation, { ownerName: node.id?.name, member: name }), seen);
    }
    const bases = syntaxClasses.has(node.type) ? [node.superClass] : (node.extends ?? []).map(entry => entry.expression);
    return bases.flatMap(base => values(syntaxChild(ref, base), seen).flatMap(value => property(value, name, seen)));
  }
  function returns(ref, seen) {
    const { node } = ref;
    if (node.returnType) return values(syntaxChild(ref, node.returnType), seen);
    if (!node.body) return [];
    if (node.body.type !== 'BlockStatement') return values(syntaxChild(ref, node.body), seen);
    const found = [];
    function findReturns(current) {
      if (syntaxFunctions.has(current.type) || syntaxClasses.has(current.type)) return;
      if (current.type === 'ReturnStatement') found.push(...values(syntaxChild(ref, current.argument), seen));
      else for (const entry of syntaxChildren(current)) findReturns(entry);
    }
    findReturns(node.body);
    return found;
  }
  function values(ref, seen = new Set()) {
    const { unit } = ref, node = unwrap(ref.node);
    if (!node || seen.has(node)) return [];
    const next = new Set(seen).add(node);
    if (node.type === 'Identifier') {
      const type = ref.types?.get(node.name);
      return type ? values(type, next) : binding(unit, lookup(unit, node, node.name), next);
    }
    if (node.type === 'ThisExpression') {
      for (let parent = unit.parents.get(node); parent; parent = unit.parents.get(parent)) if (syntaxClasses.has(parent.type)) return [make(unit, parent, { instance: true })];
      return [];
    }
    if (node.type === 'TSTypeAnnotation') return values({ ...ref, node: node.typeAnnotation }, next);
    if (node.type === 'TSLiteralType') return values(syntaxChild(ref, node.literal), next).map(value => decorate(value, { literalType: true }));
    if (node.type === 'TSTypeQuery') return values(syntaxChild(ref, node.exprName), next);
    if (node.type === 'TSTypeAliasDeclaration') return [{ ...ref, node }];
    if (node.type === 'TSTypeReference') {
      const args = node.typeArguments?.params ?? node.typeParameters?.params ?? [];
      if (node.typeName.type === 'Identifier' && ['Readonly', 'Partial', 'Required', 'NonNullable'].includes(node.typeName.name)
        && lookup(unit, node, node.typeName.name) === null) return args.flatMap(arg => values(syntaxChild(ref, arg), next));
      const targets = values(syntaxChild(ref, node.typeName), next);
      if (targets.length === 0) return [{ ...ref, node }];
      return targets.map(value => {
        const types = new Map(value.types);
        for (const [index, param] of (value.node.typeParameters?.params ?? []).entries()) {
          const arg = args[index];
          if (arg) types.set(keyOf(param.name), syntaxChild(ref, arg));
          else if (param.default ?? param.constraint) types.set(keyOf(param.name), syntaxChild(value, param.default ?? param.constraint));
        }
        return decorate(value, { types });
      });
    }
    if (node.type === 'TSQualifiedName') return values(syntaxChild(ref, node.left), next).flatMap(value => property(value, keyOf(node.right), next));
    if (['TSUnionType', 'TSIntersectionType'].includes(node.type)) return node.types.flatMap(type => values(syntaxChild(ref, type), next));
    if (node.type === 'MemberExpression') {
      const names = node.computed ? values(syntaxChild(ref, node.property), next).filter(value => value.node.type === 'Literal').map(value => keyOf(value.node)) : [keyOf(node.property)];
      return values(syntaxChild(ref, node.object), next).flatMap(value => names.flatMap(name => property(value, name, next)));
    }
    if (node.type === 'ConditionalExpression') return [node.consequent, node.alternate].flatMap(value => values(syntaxChild(ref, value), next));
    if (node.type === 'LogicalExpression') return [node.left, node.right].flatMap(value => values(syntaxChild(ref, value), next));
    if (node.type === 'NewExpression') return values(syntaxChild(ref, node.callee), next).map(value => decorate(value, { instance: true }));
    if (node.type === 'CallExpression') {
      const callee = unwrap(node.callee);
      if (callee.type === 'MemberExpression' && keyOf(callee.property) === 'bind') return values(syntaxChild(ref, callee.object), next);
      return values(syntaxChild(ref, callee), next).flatMap(value => returns(value, next));
    }
    return [{ ...ref, node }];
  }
  function origins(ref, seen = new Set()) {
    const node = unwrap(ref?.node);
    if (!node || seen.has(node)) return [];
    const next = new Set(seen).add(node);
    if (ref.initial?.node) return [ref.initial];
    if (node.type !== 'Identifier') return [ref];
    function raw(unit, entry, trail) {
      if (!entry || trail.has(entry)) return [];
      const visited = new Set(trail).add(entry);
      if (entry.local) return raw(unit, unit.scope.names.get(entry.local), visited);
      if (entry.source) {
        const marker = `${unit.file}#${entry.source}#${entry.imported}`;
        if (visited.has(marker)) return [];
        visited.add(marker);
        const other = load(targetFor(unit.file, entry.source));
        if (other === null || entry.imported === '*') return [];
        const own = other.exports.get(entry.imported);
        if (own) return raw(other, own, visited);
        return other.stars.flatMap(source => raw(other, { source, imported: entry.imported }, visited));
      }
      let refs = entry.refs ?? [];
      for (const name of entry.path ?? []) refs = refs.flatMap(value => values(value, next).flatMap(row => property(row, name, next)));
      return refs;
    }
    return raw(ref.unit, lookup(ref.unit, node, node.name), new Set());
  }
  return { primary, make, values, property, lookup, returns, origins, units };
}
