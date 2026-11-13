import { exportedPath } from './layer-exports.mjs';
import { noGeneratedImportRule, noGeneratedJsonImportRule } from './no-generated-import.mjs';
import { execMaxBufferRule } from './exec-max-buffer.mjs';
import { recordedDebtRule } from './recorded-debt.mjs';
import { BASE64_POLICY, noBase64Rule } from './no-base64.mjs';
import { SIDES_FILE, SIDE_EDGES_FILE, engineSidesRule } from './engine-sides.mjs';
import { clientPlanSchemaViolations } from './client-plan-boundary.mjs';
import { explicitSchemaTypes } from './schema-types.mjs';
import { declarationConfigProgram } from './declaration-config.mjs';
// Wildshard's own oxlint rules (loaded by `jsPlugins` in .oxlintrc.json; oxlint's ESLint-compatible JS plugin API).
//
// wildshard/no-url-switch — Jake, 2026-09-25: "NO URL SWITCHES EVER, ALL VARIANTS IN THE DEBUG MENUS".
// He plays the game as an iOS home-screen PWA: there is no address bar, so a `?foo=` switch is a switch he can never
// flip. A variant, look, tuning or feature toggle goes in pause ▸ Settings ▸ Debug. The only query params the game may
// read are the fixed allowlist in lint/url-params.json (`harness`: what the test / capture / bench scripts pass;
// `legacy`: the old switches, all moved or deleted by E162 — never add to it).
//
// What it flags, in src/ (see .oxlintrc.json for the file scope):
//   · `.get(k)` / `.has(k)` / `.getAll(k)` on a URLSearchParams — `new URLSearchParams(…)`, `x.searchParams`, a name
//     bound to either in the file, a name typed `URLSearchParams`, and `params` — when `k` is not on the allowlist;
//   · a key the rule cannot read as a string: resolved through in-file string consts, `export const X = '…'` in a
//     relatively imported module, a parameter typed as a string-literal union, or every call of the helper whose
//     parameter it is (`num('scale', 1)`) — anything else is an error;
//   · raw parsing of `location.search` (`.includes`, `.match`, regex `.test`, …) that dodges the above.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simClosure, simRoot } from './sim-closure.mjs';
import { authoredHtmlSites } from './authored-html.mjs';
import { runtimePerformanceViolations } from './runtime-performance.mjs';
import { shardGameImport, shardEngineImport, sharddevRuntimeImport, generatorImportViolation } from './shard-imports.mjs';
import { shardfileBoundaryVisitors } from './shardfile-boundaries.mjs';
import { hostCallbackSites } from './host-callback-syntax.mjs';
import { hostPlayFile } from './host-files.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));
/** E432: the layers are workspace packages, `@wildshard/<layer>[/<sub>]` → `src/<layer>/<sub | index>`. Whether a
 *  subpath is public (in the package's `exports`) is the `public-index` check's job; a deep one maps to its file so it
 *  is reported (it does not resolve at build time either). */

// P3: game and host live in the one @wildshard/engine package (lift-engine.mjs).
const liftedSpecifier = (source) => source.replace(/^@wildshard\/engine\/game\//u, '@wildshard/game/').replace(/^@wildshard\/engine\/host\//u, '@wildshard/sdk/');
const unsidedPath = (path) => path.replace(/^src\/(client|shared|server|cook)\/(engine|game)\//u, 'src/$2/$1/').replace(/^src\/(?:client|shared|server|cook)\/host\//u, 'src/sdk/').replace(/^src\/test\/(engine|game)\//u, 'src/$1/test/').replace(/^src\/client\/app\/([^/]+)$/u, 'src/$1');
const layerKey = (layer, sub) => (sub === undefined ? '.' : `./${{ engine: '', game: 'game/', sdk: 'host/' }[layer] ?? ''}${sub}`);
const LAYER_PACKAGE = /^@wildshard\/(engine|format|wire|game|sdk|sharddev|commons)(?![\w-])(?:\/([^?]+))?/u;
const packageTarget = (source) => {
  const m = LAYER_PACKAGE.exec(liftedSpecifier(source));
  if (!m) return null;
  const [, layer, sub = 'index'] = m;
  return exportedPath(layer, m[2])?.replace(/\.ts$/u, '') ?? `src/${layer}/${sub}`;
};
/** a package subpath its package.json `exports` lists (the URL-param resolver follows only those) */
const packageExports = new Map();
const exported = (source) => {
  const m = LAYER_PACKAGE.exec(liftedSpecifier(source));
  if (!m) return false;
  if (!packageExports.has(m[1])) {
    const file = ['format', 'wire', 'sharddev'].includes(m[1]) ? resolve(process.cwd(), `node_modules/@wildshard/${m[1]}/package.json`) : new URL('../package.json', import.meta.url);
    packageExports.set(m[1], existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).exports ?? {} : {});
  }
  return Object.hasOwn(packageExports.get(m[1]), layerKey(m[1], m[2]));
};

const ALLOWLIST_FILE = new URL('url-params.json', import.meta.url);
const allowlist = JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf8'));
const ALLOWED = new Set([...allowlist.harness, ...allowlist.legacy]);
/** reader helpers whose argument is a param name (e.g. `readParam('name')`): name → argument index. Their calls are checked in every file. */
const READERS = new Map(Object.entries(allowlist.readers ?? {}));

const FIX =
  'A variant, look, tuning or feature toggle goes in pause ▸ Settings ▸ Debug (a shard\'s own ctx.debugRow, or an engine-wide src/client/engine/ui/Settings.ts OPTION_VALUES key + one row in src/client/engine/ui/debugOptions.ts, under its group), ' +
  'never in the query string: Jake plays the iOS home-screen PWA and has no address bar. Harness params are a fixed allowlist in ' +
  'lint/url-params.json; adding one needs Jake\'s explicit OK. See AGENTS.md "No URL switches".';
const MSG_NAME = (name) => `No URL switches, ever (Jake, 2026-09-25): \`?${name}\` is not an allowed query param. ${FIX}`;
const MSG_DYNAMIC = `No URL switches, ever (Jake, 2026-09-25): this query-param key is not a string literal, so it cannot be checked against the allowlist. Read each param by its literal name. ${FIX}`;
const MSG_RAW = (what) => `No URL switches, ever (Jake, 2026-09-25): raw \`location.search\` parsing (${what}) dodges the allowlist. Use URLSearchParams with a literal, allowlisted name. ${FIX}`;

const READS = new Set(['get', 'has', 'getAll']);
const STRING_METHODS = new Set(['includes', 'indexOf', 'lastIndexOf', 'match', 'matchAll', 'search', 'split', 'startsWith', 'endsWith', 'slice', 'substring', 'substr', 'replace', 'replaceAll', 'at', 'charAt']);
const DEFAULT_BOUND = ['params', 'searchParams'];

const unwrap = (n) => {
  let x = n;
  while (x && (x.type === 'ChainExpression' || x.type === 'TSNonNullExpression' || x.type === 'TSAsExpression' || x.type === 'TSSatisfiesExpression' || x.type === 'ParenthesizedExpression')) x = x.expression;
  return x;
};
const propName = (m) => (m.type === 'MemberExpression' && !m.computed && m.property.type === 'Identifier' ? m.property.name : null);
const isLocation = (n) => {
  const x = unwrap(n);
  if (!x) return false;
  if (x.type === 'Identifier') return x.name === 'location';
  const p = propName(x);
  return p === 'location';
};
const isLocationSearch = (n) => {
  const x = unwrap(n);
  return Boolean(x) && x.type === 'MemberExpression' && propName(x) === 'search' && isLocation(x.object);
};
const stringOf = (n) => {
  const x = unwrap(n);
  if (!x) return null;
  if (x.type === 'Literal' && typeof x.value === 'string') return x.value;
  if (x.type === 'TemplateLiteral' && x.expressions.length === 0) return x.quasis[0]?.value.cooked ?? null;
  return null;
};
/** does this type annotation mention URLSearchParams (`URLSearchParams`, `URLSearchParams | undefined`, …)? */
const mentionsUSP = (t) => {
  if (!t || typeof t !== 'object') return false;
  if (t.type === 'TSTypeAnnotation') return mentionsUSP(t.typeAnnotation);
  if (t.type === 'TSTypeReference') return t.typeName.type === 'Identifier' && t.typeName.name === 'URLSearchParams';
  if (t.type === 'TSUnionType' || t.type === 'TSIntersectionType') return t.types.some(mentionsUSP);
  return false;
};
/** the names in a string-literal union annotation (`key: 'grade' | 'ground'`), or null */
const literalUnion = (t) => {
  let x = t;
  if (x?.type === 'TSTypeAnnotation') x = x.typeAnnotation;
  if (!x) return null;
  const parts = x.type === 'TSUnionType' ? x.types : [x];
  const out = [];
  for (const p of parts) {
    if (p.type === 'TSLiteralType' && p.literal.type === 'Literal' && typeof p.literal.value === 'string') out.push(p.literal.value);
    else return null;
  }
  return out;
};
const paramId = (p) => {
  let x = p;
  if (x.type === 'TSParameterProperty') x = x.parameter;
  if (x.type === 'AssignmentPattern') x = x.left;
  return x.type === 'Identifier' ? x : null;
};
const fnName = (fn) => {
  if (fn.id?.type === 'Identifier') return fn.id.name;
  const p = fn.parent;
  if (!p) return null;
  if (p.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name;
  if ((p.type === 'MethodDefinition' || p.type === 'PropertyDefinition' || p.type === 'Property') && p.key.type === 'Identifier') return p.key.name;
  if (p.type === 'AssignmentExpression') return p.left.type === 'Identifier' ? p.left.name : propName(p.left);
  return null;
};
const calleeName = (c) => {
  const x = unwrap(c);
  if (!x) return null;
  return x.type === 'Identifier' ? x.name : propName(x);
};
/** `export const NAME = '…'` in a relative or package-aliased module (resolved .ts / .js / index). */
export const importedConst = (fromFile, source, name) => {
  const target = exported(source) ? packageTarget(source) : null;
  if (target === null && !source.startsWith('.')) return null;
  const base = target === null ? resolve(dirname(fromFile), source) : resolve(REPO, target);
  const tries = [base, `${base}.ts`, `${base}.js`, base.replace(/\.js$/u, '.ts'), `${base}/index.ts`];
  for (const f of tries) {
    if (!existsSync(f) || !/\.(ts|js|mjs)$/u.test(f)) continue;
    const m = new RegExp(`export\\s+const\\s+${name}\\s*(?::[^=]+)?=\\s*['"\`]([^'"\`]+)['"\`]`, 'u').exec(readFileSync(f, 'utf8'));
    return m === null ? null : m[1];
  }
  return null;
};
/** the param names a regex / string pattern names: `[?&]sw=0` → sw */
const namesInPattern = (s) => [...s.matchAll(/\[\?&\]\(?([A-Za-z_][\w]*)/gu)].map((m) => m[1] ?? '').filter(Boolean);

const noUrlSwitch = {
  meta: {
    type: 'problem',
    docs: { description: 'No URL switches: a query param the game reads must be on the fixed allowlist in lint/url-params.json (Jake, 2026-09-25)' },
    schema: [],
  },
  create(context) {
    const filename = context.filename;
    const bound = new Set(DEFAULT_BOUND); // names (identifiers and property names) that hold a URLSearchParams
    const declarators = []; // [name, init] to settle in a fixpoint once the file is read
    const consts = new Map(); // in-file `const X = 'literal'`
    const imports = new Map(); // local name → [source, imported name]
    const reads = []; // { key node }
    const calls = []; // every call, for helper resolution: { name, args }
    const raws = []; // [node, what]
    const readerCalls = []; // calls of a READERS helper, checked like a read

    const isQuery = (n) => {
      const x = unwrap(n);
      if (!x) return false;
      if (x.type === 'NewExpression') return x.callee.type === 'Identifier' && x.callee.name === 'URLSearchParams';
      if (x.type === 'Identifier') return bound.has(x.name);
      if (x.type === 'MemberExpression') { const p = propName(x); return p !== null && bound.has(p); }
      if (x.type === 'ConditionalExpression') return [x.consequent, x.alternate].some(isQuery);
      if (x.type === 'LogicalExpression') return [x.left, x.right].some(isQuery);
      return false;
    };

    /** names for a key node: string[] on success, null when it cannot be read */
    const resolveKey = (key, depth) => {
      const s = stringOf(key);
      if (s !== null) return [s];
      const x = unwrap(key);
      if (!x || depth > 3) return null;
      if (x.type === 'ConditionalExpression') {
        const a = resolveKey(x.consequent, depth + 1);
        const b = resolveKey(x.alternate, depth + 1);
        return a && b ? [...a, ...b] : null;
      }
      if (x.type !== 'Identifier') return null;
      if (consts.has(x.name)) return [consts.get(x.name)];
      const imp = imports.get(x.name);
      if (imp) { const v = importedConst(filename, imp[0], imp[1]); return v === null ? null : [v]; }
      // a parameter of an enclosing function: its literal-union type, or every call of that helper in this file
      for (let fn = x.parent; fn; fn = fn.parent) {
        if (fn.type !== 'FunctionDeclaration' && fn.type !== 'FunctionExpression' && fn.type !== 'ArrowFunctionExpression') continue;
        const index = fn.params.findIndex((p) => paramId(p)?.name === x.name);
        if (index === -1) continue;
        const id = paramId(fn.params[index]);
        const lit = id ? literalUnion(id.typeAnnotation) : null;
        if (lit) return lit;
        const name = fnName(fn);
        if (!name) return null;
        if (READERS.get(name) === index) return []; // an allowlisted reader: its calls are checked where they are made
        const uses = calls.filter((c) => c.name === name && c.args.length > index);
        if (uses.length === 0) return null;
        const out = [];
        for (const u of uses) { const r = resolveKey(u.args[index], depth + 1); if (!r) return null; out.push(...r); }
        return out;
      }
      return null;
    };

    return {
      ImportDeclaration(node) {
        for (const s of node.specifiers) if (s.type === 'ImportSpecifier' && s.imported.type === 'Identifier') imports.set(s.local.name, [node.source.value, s.imported.name]);
      },
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier') return;
        if (mentionsUSP(node.id.typeAnnotation)) bound.add(node.id.name);
        const s = node.init ? stringOf(node.init) : null;
        if (s !== null && node.parent?.kind === 'const') consts.set(node.id.name, s);
        if (node.init) declarators.push([node.id.name, node.init]);
      },
      AssignmentExpression(node) {
        const name = node.left.type === 'Identifier' ? node.left.name : propName(node.left);
        if (name) declarators.push([name, node.right]);
      },
      Identifier(node) {
        if (node.typeAnnotation && mentionsUSP(node.typeAnnotation)) bound.add(node.name);
      },
      TSPropertySignature(node) {
        if (node.key.type === 'Identifier' && mentionsUSP(node.typeAnnotation)) bound.add(node.key.name);
      },
      PropertyDefinition(node) {
        if (node.key.type !== 'Identifier') return;
        if (mentionsUSP(node.typeAnnotation)) bound.add(node.key.name);
        if (node.value) declarators.push([node.key.name, node.value]);
      },
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (name) calls.push({ name, args: node.arguments });
        if (name && READERS.has(name)) readerCalls.push({ key: node.arguments[READERS.get(name)] ?? null, node });
        const callee = unwrap(node.callee);
        if (callee?.type === 'MemberExpression') {
          const m = propName(callee);
          if (m && READS.has(m)) reads.push({ callee, key: node.arguments[0] ?? null, node });
          // `location.search.includes('x=')`, `.match(…)`, `.split('&')` …
          if (m && STRING_METHODS.has(m) && isLocationSearch(callee.object)) raws.push([node, `location.search.${m}()`]);
          // `/[?&]x=/.test(location.search)` / `.exec(location.search)`
          if ((m === 'test' || m === 'exec') && node.arguments.some(isLocationSearch)) {
            const re = unwrap(callee.object);
            const pat = re?.type === 'Literal' && re.regex ? re.regex.pattern : null;
            const names = pat ? namesInPattern(pat) : [];
            if (names.length === 0 || names.some((n) => !ALLOWED.has(n))) raws.push([node, `a regex ${m}() on location.search`]);
          }
        }
      },
      'Program:exit'() {
        // settle `const qs = new URLSearchParams(…)`, `const u = new URL(…); u.searchParams`, `const q2 = qs` …
        for (let changed = true; changed; ) {
          changed = false;
          for (const [name, init] of declarators) if (!bound.has(name) && isQuery(init)) { bound.add(name); changed = true; }
        }
        for (const r of [...reads.filter((x) => isQuery(x.callee.object)), ...readerCalls]) {
          if (!r.key) { context.report({ node: r.node, message: MSG_DYNAMIC }); continue; }
          const names = resolveKey(r.key, 0);
          if (!names) { context.report({ node: r.key, message: MSG_DYNAMIC }); continue; }
          const bad = names.filter((n) => !ALLOWED.has(n));
          if (bad.length > 0) context.report({ node: r.key, message: MSG_NAME(bad.join('`, `?')) });
        }
        for (const [node, what] of raws) context.report({ node, message: MSG_RAW(what) });
      },
    };
  },
};

// E357 F4: syntactic ratchets; their scope and patterns are 01 §24 / 02 F4's contract.
// Filenames and lexical import paths are immutable during one plugin process.
const filenamePaths = new Map(), modulePaths = new Map();
const pathOf = (context) => {
  const cached = filenamePaths.get(context.filename);
  if (cached !== undefined) return cached;
  const path = relative(REPO, context.filename).replaceAll('\\', '/');
  const index = path.lastIndexOf('/src/');
  const normalized = index === -1 ? path : path.slice(index + 1);
  filenamePaths.set(context.filename, normalized);
  return normalized;
};
const modulePath = (filename, source) => {
  let paths = modulePaths.get(filename);
  if (paths === undefined) { paths = new Map(); modulePaths.set(filename, paths); }
  if (paths.has(source)) return paths.get(source);
  const target = packageTarget(source);
  const path = target ?? (!source.startsWith('.') ? source
    : relative(REPO, resolve(dirname(filename), source)).replaceAll('\\', '/').replace(/^.*\/src\//u, 'src/'));
  paths.set(source, path);
  return path;
};
const layerOf = (liftedPath) => {
  const path = unsidedPath(liftedPath);
  const match = /^src\/(engine|format|wire|game|sdk|sharddev|commons|shards)(?:\/([^/]+)?)?$/u.exec(path) ?? /^src\/(engine|format|wire|game|sdk|sharddev|commons|shards)\/([^/]+)?/u.exec(path);
  if (!match) return /^src\/[^/]+$/u.test(path) ? { name: 'app', rank: 6, slug: null } : null;
  // WIRE-STABILITY WR2: @wildshard/wire is a pure contract package beside format, at its rank
  const rank = match[1] === 'wire' ? 0 : ['format', 'engine', 'game', 'sdk', 'sharddev', 'commons', 'shards'].indexOf(match[1]);
  return { name: match[1], rank, slug: match[1] === 'shards' ? match[2] : null };
};
const engineWords = JSON.parse(readFileSync(new URL('engine-words.json', import.meta.url), 'utf8'));
// P3: the generated list needs shard source. Where that has left, the pin keeps these rules' words.
const generatedWordsFile = new URL('shard-words.generated.json', import.meta.url);
const shardWords = JSON.parse(readFileSync(existsSync(generatedWordsFile) ? generatedWordsFile : new URL('shard-words.pin.json', import.meta.url), 'utf8'));
const escapeRegex = (text) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
const WORDS = new RegExp(`\\b(?:${[...new Set([...engineWords, ...shardWords.words])].map(escapeRegex).join('|')})\\b`, 'giu');
const rule = (description, create) => ({ meta: { type: 'problem', docs: { description }, schema: [] }, create });
const report = (context, node, message) => { context.report({ node, message }); };
const importsVisitor = (fn) => ({
  ImportDeclaration: fn,
  ExportNamedDeclaration(node) { if (node.source) fn(node); },
  ExportAllDeclaration: fn,
  ImportExpression: fn,
});
const importPrefix = (node) => {
  const x = unwrap(node);
  // E405 AG27: a '+' chain resolves by its leading string, like a template literal's first quasi.
  if (x?.type === 'BinaryExpression' && x.operator === '+') return importPrefix(x.left);
  return stringOf(x) ?? (x?.type === 'TemplateLiteral' ? x.quasis[0]?.value.cooked : null);
};
const computedSpecifier = (node) => {
  const x = unwrap(node);
  return (x?.type === 'TemplateLiteral' && x.expressions.length > 0) || (x?.type === 'BinaryExpression' && x.operator === '+');
};
const globCall = (node) => {
  const callee = unwrap(node.callee), object = unwrap(callee?.object);
  return callee?.type === 'MemberExpression' && ['glob', 'globEager'].includes(propName(callee)) && object?.type === 'MetaProperty' && object.meta.name === 'import' && object.property.name === 'meta';
};

const ratchetFile = process.env.WILDSHARD_RATCHET_FILE ?? new URL('ratchet.json', import.meta.url);
const contractAllow = existsSync(ratchetFile) ? JSON.parse(readFileSync(ratchetFile, 'utf8')).allow?.['wildshard/engine-words'] ?? {} : {};
/** a property name or key (`{ shard: … }`, `x.shard`, `c['shard']`, `T['shard']`), a `harness.shard.<id>` debug key or a model id
 *  (`shared/shard-altar`): a contract's field, not code */
function contractField(node) {
  const p = node.parent;
  if (node.type === 'Identifier') return (['Property', 'TSPropertySignature', 'PropertyDefinition', 'MethodDefinition'].includes(p?.type) && p.key === node) || (p?.type === 'MemberExpression' && p.property === node);
  if (node.type === 'Literal') return (p?.type === 'MemberExpression' && p.property === node) || (p?.type === 'Property' && p.key === node)
    || (p?.type === 'TSLiteralType' && p.parent?.type === 'TSIndexedAccessType')   // Probe['shard']
    || (typeof node.value === 'string' && /^shared\/[a-z-]+$/u.test(node.value));   // a model id
  if (node.type === 'TemplateElement') return (node.value.cooked ?? '').startsWith('harness.shard.');
  return false;
}
// E405 AG2: one walk, three rules, so each ratchets on its own: `layer` (direction, shard ↔ shard, files and imports
// outside the layers), `public-index` (cross-layer imports skip the public index) and `engine-words` (Wildshard
// vocabulary in engine code; comments are not counted).
const layerWalk = (kind) => (context) => {
  const own = layerOf(pathOf(context));
  // E405 AG23: every src file sits in a layer; a new top-level src/<dir>/ would escape all of them.
  if (!own) return kind === 'layer' && pathOf(context).startsWith('src/') ? { Program(node) { report(context, node, `File outside the engine / format / game / sdk / commons / shards layers: ${pathOf(context)}`); } } : {};
  if (kind === 'words') {
    if (own.name !== 'engine') return {};
    const words = (node, text) => {
      // Most identifiers contain no forbidden token. Avoid allocating a match
      // iterator for them; retain the full matching loop for every positive.
      if (!WORDS.test(text)) return;
      WORDS.lastIndex = 0;
      for (const match of text.matchAll(WORDS)) {
        const path = pathOf(context);
        // F10's save protocol names a shard scope; its one-time reset table necessarily names historical keys.
        if (match[0].toLowerCase() === 'shard' && (/^src\/(?:client|cook|server|shared)\/engine\/saves\//u.test(path) || (node.type === 'Literal' && node.value === 'shard' && node.parent?.type === 'Property' && (node.parent.key?.name === 'scope' || node.parent.key?.value === 'scope')))) continue;
        if (path === 'src/client/engine/core/errorReport.ts' && node.type === 'Identifier' && node.name === 'shard' && node.parent?.type === 'Property' && node.parent.key === node) continue; // Required external telemetry tag; save failures use their namespace.
        if (path === 'src/shared/engine/saves/legacy.ts' && node.type === 'Literal' && typeof node.value === 'string' && node.value.startsWith('ws.')) continue;
        // E405 (Jake): a wire contract's field is still named `shard` (telemetry tags, reports, the harness probe) — only as a
        // property name or key, only in the files lint/ratchet.json `allow['wildshard/engine-words']` lists with the reason
        if (match[0].toLowerCase() === 'shard' && Object.hasOwn(contractAllow, path) && contractField(node)) continue;
        report(context, node, `Engine contains Wildshard word: ${match[0]}`);
      }
    };
    return {
      Identifier(node) { words(node, node.name); },
      Literal(node) { if (typeof node.value === 'string') words(node, node.value); },
      TemplateElement(node) { words(node, node.value.cooked ?? node.value.raw); },
    };
  }
  const checkImport = (node, source, dynamic = false) => {
    if (typeof source !== 'string' || source === '') return;
    const targetPath = modulePath(context.filename, source);
    const target = layerOf(targetPath);
    // SF54: @wildshard/kit is dissolved; a workspace specifier names one of the layer packages or nothing
    if (kind === 'layer' && source.startsWith('@wildshard/') && packageTarget(source) === null) report(context, node, `No such layer package: ${source}`);
    if (kind === 'layer' && own.name === 'commons' && target && !['commons', 'sdk', 'sharddev', 'format', 'wire'].includes(target.name)) report(context, node, `Commons author tools import only the SDK and pure format contracts: ${source}`);
    if (kind === 'layer' && own.name === 'commons' && targetPath.startsWith('src/sharddev/runtime/')) report(context, node, `Commons author tools cannot import trusted runtime code: ${source}`);
    const shardLocal = /^src\/shards\/[^/]+\/(.+)$/u.exec(pathOf(context))?.[1];
    if (kind === 'layer' && shardLocal !== undefined) {
      if (/^@wildshard\/sharddev\/runtime(?:\/|$)/u.test(source) || targetPath.startsWith('src/sharddev/runtime/')) report(context, node, `Primary shards cannot import trusted SDK runtime: ${source}`);
      if (target?.name === 'commons' && !/^(?:generators|bake|data|quests)\//u.test(shardLocal) && shardLocal !== 'shard.config.ts') report(context, node, `Commons packs are build-time imports: ${source}`);
    }
    if (!target) {
      if (kind === 'layer' && targetPath.startsWith('src/')) report(context, node, `Import of a file outside the layers: ${source}`);
      return;
    }
    const publicAuthor = /^src\/shards\/[^/]+\/(?:shard\.config\.ts$|(?:data|behaviour|quests)\/)/u.test(pathOf(context));
    if (kind === 'layer' && publicAuthor && ['engine', 'game'].includes(target.name)) report(context, node, `Author imports use @wildshard/sdk: ${source}`);
    // public: an entry the layer's package.json `exports` lists (E432), or a relative path to its index
    const publicPath = !dynamic && (exported(source) || new RegExp(`^src/${target.name}(?:/index(?:\\.[jt]s)?)?$`, 'u').test(targetPath));
    if (target.rank > own.rank || (own.name === 'shards' && target.name === 'shards' && own.slug !== target.slug)) {
      if (kind === 'layer') report(context, node, `Layer import ${own.name} → ${target.name}: ${source}`);
    } else if (kind === 'public' && own.name !== target.name && ['engine', 'format', 'wire', 'game', 'sdk', 'sharddev', 'commons'].includes(target.name) && !publicPath) {
      report(context, node, `Cross-layer imports use the public index: ${source}`);
    }
  };
  return {
    ...importsVisitor((node) => {
      checkImport(node, importPrefix(node.source), computedSpecifier(node.source));
    }),
    CallExpression(node) {
      if (!globCall(node)) return;
      const arg = unwrap(node.arguments[0]);
      for (const pattern of arg?.type === 'ArrayExpression' ? arg.elements : [arg]) checkImport(node, importPrefix(pattern)?.replace(/^!/u, ''));
    },
  };
};
// G143: runtime/ never reaches build-time commons (SF54 retired every kit site and dissolved the kit; a hard rule since).
const runtimeCommons = rule('Runtime cannot import build-time commons code (G143 / SF54)', (context) => {
  if (!/^src\/shards\/[^/]+\/runtime\//u.test(pathOf(context))) return {};
  return importsVisitor((node) => {
    const source = importPrefix(node.source);
    if (typeof source !== 'string') return;
    const target = modulePath(context.filename, source);
    if (/^@wildshard\/commons(?:\/|$)/u.test(source) || target.startsWith('src/commons/')) report(context, node, `Runtime imports cannot use commons code: ${source}`);
  });
});
// SF62: only the reviewed exact predecessor sites remain during the first-party conversions.
const runtimeDebt = JSON.parse(readFileSync(new URL('runtime-performance.json', import.meta.url), 'utf8')).sites;

const runtimePerformance = rule('Custom runtime has bounded work and no frame allocations, raw rendering, DOM, timers or fetch', context => {
  const filename = pathOf(context);
  if (!/^src\/shards\/[^/]+\/runtime\/.*\.[jt]s$/u.test(filename)) return {};
  return { Program(program) {
    for (const site of runtimePerformanceViolations(context.sourceCode.text, filename, runtimeDebt, program)) {
      context.report({ loc: { line: site.line, column: 0 }, message: `${site.kind}: ${site.message}` });
    }
  } };
});
const layer = rule('Layer direction: imports point down, shards never import shards, every src file has a layer (E357, E405)', layerWalk('layer'));
const publicIndex = rule('Cross-layer imports use the public index (E357, E405 AG2)', layerWalk('public'));
const engineWordsRule = rule('Engine code carries no Wildshard vocabulary (E357, E405 AG2)', layerWalk('words'));

export const SHARD_BRANCH = {
  identifiers: new Set(['isOcean', 'isNalati', 'isPine', 'isNine', 'LOOK_V2']),
  calls: new Set(['nalatiNow', 'isStylized', 'isPaintedAir', 'isPainterlyGrass']),
  comparisons: new Set(['slug', 'style']),
  members: new Set(['structures', 'weapon', 'style', 'ocean']),
  objects: new Set(['chunk', 'def', 'manifest']),
  slugs: new Set(shardWords.slugs),
};
const nameOf = (node) => {
  const x = unwrap(node);
  return x?.type === 'Identifier' ? x.name : x?.type === 'MemberExpression' ? propName(x) : null;
};
const isReference = (node) => {
  const parent = node.parent;
  if (!parent) return true;
  if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return false;
  if (['ImportSpecifier', 'ImportDefaultSpecifier', 'ImportNamespaceSpecifier', 'ExportSpecifier'].includes(parent.type)) return false;
  if ((parent.type === 'VariableDeclarator' || parent.type === 'FunctionDeclaration' || parent.type === 'ClassDeclaration') && parent.id === node) return false;
  if (['Property', 'PropertyDefinition', 'MethodDefinition', 'TSPropertySignature'].includes(parent.type) && parent.key === node && !parent.computed && !parent.shorthand) return false;
  return true;
};
const noShardBranch = rule('Shard decisions belong in plugins (E357)', (context) => {
  const path = pathOf(context);
  if (path.startsWith('src/shards/')) return {};
  const hits = new Set();
  return {
    Identifier(node) { if (SHARD_BRANCH.identifiers.has(node.name) && isReference(node)) hits.add(node); },
    CallExpression(node) { if (SHARD_BRANCH.calls.has(calleeName(node.callee))) hits.add(node); },
    ConditionalExpression(node) { if (['sea', 'painterly'].includes(nameOf(node.test))) hits.add(node); },
    LogicalExpression(node) { if (node.operator === '&&' && nameOf(node.left) === 'painterly') hits.add(node); },
    BinaryExpression(node) {
      if (!['===', '!==', '==', '!='].includes(node.operator)) return;
      if ([node.left, node.right].some((side) => SHARD_BRANCH.slugs.has(stringOf(side))) ||
          (['===', '!=='].includes(node.operator) && [node.left, node.right].some((side) => SHARD_BRANCH.comparisons.has(nameOf(side))))) hits.add(node);
    },
    SwitchCase(node) { if (node.test && SHARD_BRANCH.slugs.has(stringOf(node.test))) hits.add(node); },
    Property(node) { if (layerOf(path)?.name !== 'engine' && SHARD_BRANCH.slugs.has(stringOf(node.key) ?? node.key?.name)) hits.add(node); },
    MemberExpression(node) {
      if (layerOf(path)?.name !== 'engine' && node.computed && SHARD_BRANCH.slugs.has(stringOf(node.property))) hits.add(node);
      if (!SHARD_BRANCH.members.has(propName(node))) return;
      if (node.parent?.type === 'AssignmentExpression' && node.parent.left === node && node.parent.operator === '=') return;
      const object = unwrap(node.object);
      if (SHARD_BRANCH.objects.has(nameOf(object)) || (object?.type === 'CallExpression' && calleeName(object.callee) === 'getActiveChunk')) hits.add(node);
    },
    'Program:exit'() {
      for (const node of hits) {
        let ancestor = node.parent;
        while (ancestor && ['ChainExpression', 'TSAsExpression', 'TSSatisfiesExpression', 'ParenthesizedExpression'].includes(ancestor.type)) ancestor = ancestor.parent;
        // Only a comparison's overlapping clauses collapse; nested decisions remain separate expressions.
        if (ancestor?.type !== 'BinaryExpression' || !hits.has(ancestor)) report(context, node, 'Shard-specific expression belongs in the shard plugin');
      }
    },
  };
});

const noRawSave = rule('Storage access belongs in saves (E357)', (context) => {
  if (/^src\/(?:client|cook|server|shared)\/engine\/(?:saves|native)\//u.test(pathOf(context))) return {};
  return { Identifier(node) { if (['localStorage', 'sessionStorage'].includes(node.name)) report(context, node, 'Use the save service instead of raw storage'); } };
});
export const TIME_ALLOW = Object.fromEntries([
  'src/shared/engine/core/frameCost.ts', 'src/client/engine/ui/perfHud.ts', 'src/client/engine/ui/perfProbe.ts', 'src/client/engine/ui/perfLap.ts', 'src/client/engine/ui/Perf.ts',
  'src/client/engine/boot/plan.ts', 'src/client/engine/render/precompile.ts',
  'src/client/engine/core/errorReport.ts', 'src/client/engine/boot/bootTrace.ts', 'src/client/engine/boot/gpuTrace.ts',
].map((path) => [path, 'performance.now measures elapsed cost or diagnostic timing; never gameplay state.']));
const measurementAllow = existsSync(ratchetFile) ? JSON.parse(readFileSync(ratchetFile, 'utf8')).allow?.['wildshard/no-raw-random-time'] ?? TIME_ALLOW : TIME_ALLOW;
const noRawRandomTime = rule('Randomness and time use engine services (E357)', (context) => {
  const path = pathOf(context);
  if (/^src\/(?:client|cook|server|shared)\/engine\/core\/(?:rng|clock)\.ts$/u.test(path)) return {};
  return { MemberExpression(node) {
    const object = unwrap(node.object), property = propName(node) ?? stringOf(node.property);
    if (object?.type !== 'Identifier') return;
    if (object.name === 'Math' && property === 'random') report(context, node, 'Use app.rng instead of Math.random');
    if (object.name === 'performance' && property === 'now' && !Object.hasOwn(measurementAllow, path)) report(context, node, 'Use app.clock instead of performance.now');
  } };
});
const INPUT_EVENTS = new Set('keydown keyup keypress pointerdown pointerup pointermove pointercancel mousedown mouseup mousemove wheel contextmenu touchstart touchmove touchend touchcancel'.split(' '));
const noRawInput = rule('Input listeners belong in the input service (E357)', (context) => {
  if (/^src\/(?:client|cook|server|shared)\/engine\/input\//u.test(pathOf(context))) return {};
  // E362 AG18: a helper (`scope.listen(window, 'keydown')`, `listenDom(scope, document, 'pointermove')`) is the same raw
  // page-wide listener; a widget's listener on its own element stays legal.
  const page = (n) => { const u = unwrap(n); return u?.type === 'Identifier' && (u.name === 'window' || u.name === 'document'); };
  return { CallExpression(node) {
    if (calleeName(node.callee) === 'addEventListener' && INPUT_EVENTS.has(stringOf(node.arguments[0]))) report(context, node, 'Use the input service instead of a raw input listener');
    else if (node.arguments.some(page) && node.arguments.some((a) => INPUT_EVENTS.has(stringOf(a)))) report(context, node, 'A page-wide input listener goes through listenPage (@wildshard/engine) or the input service');
  } };
});
const noRendererType = rule('Renderer types stay inside rendering (E357)', (context) => {
  if (/^src\/(?:client|cook|server|shared)\/engine\/(?:render\/|core\/(?:Game|bootstrap)\.ts$)/u.test(pathOf(context))) return {};
  return { Identifier(node) { if (node.name === 'WebGLRenderer') report(context, node, 'Renderer types belong in engine/render'); } };
});
// J322 (Jake, 2026-11-13): "Let's only do WebGL renderer. Let's not do any WebGPU renderer." Nothing imports three's
// WebGPU or TSL builds, names WebGPURenderer, or asks the browser for a WebGPU adapter; renderer.ts makes the one
// WebGLRenderer on a WebGL2 context (core/webglStartup.ts).
const WEBGPU_SOURCE = /^three\/(?:webgpu|tsl)(?:$|\/)|^three\/(?:examples\/jsm|addons)\/(?:renderers\/webgpu|nodes|tsl)(?:$|\/)|^three\/(?:examples\/jsm|addons)\/capabilities\/WebGPU(?:\.js)?$|three\.webgpu/u;
const WEBGPU_MESSAGE = 'WebGL renderer only, no WebGPU (J322)';
const isNavigator = (node) => { const x = unwrap(node); return (x?.type === 'Identifier' && x.name === 'navigator') || (x?.type === 'MemberExpression' && propName(x) === 'navigator'); };
const noWebgpu = rule('WebGL renderer only, no WebGPU (J322)', (context) => ({
  ...importsVisitor((node) => { const source = importPrefix(node.source); if (typeof source === 'string' && WEBGPU_SOURCE.test(source)) report(context, node, WEBGPU_MESSAGE); }),
  Identifier(node) { if (node.name === 'WebGPURenderer') report(context, node, WEBGPU_MESSAGE); },
  MemberExpression(node) {
    if ((propName(node) === 'gpu' || stringOf(node.property) === 'gpu') && isNavigator(node.object)) report(context, node, WEBGPU_MESSAGE);
    else if (propName(node) === 'requestAdapter') report(context, node, WEBGPU_MESSAGE);
  },
  BinaryExpression(node) { if (node.operator === 'in' && stringOf(node.left) === 'gpu' && isNavigator(node.right)) report(context, node, WEBGPU_MESSAGE); },
  VariableDeclarator(node) {
    if (node.id?.type === 'ObjectPattern' && isNavigator(node.init) && node.id.properties.some((p) => p.type === 'Property' && (p.key?.name === 'gpu' || stringOf(p.key) === 'gpu'))) report(context, node, WEBGPU_MESSAGE);
  },
}));
const SHADER_HOOKS = new Set(['onBeforeCompile', 'customProgramCacheKey']);
const noRawShaderPatch = rule('Shader patches go through the one registry (E357 X6)', (context) => {
  if (pathOf(context).startsWith('src/client/engine/render/')) return {};
  return { AssignmentExpression(node) {
    const left = unwrap(node.left);
    if (left?.type === 'MemberExpression' && SHADER_HOOKS.has(propName(left) ?? stringOf(left.property) ?? '')) report(context, node, 'Patch shaders with patchShader / setProgramKey (@wildshard/engine)');
  } };
});
// SF3a: check every runtime dependency, including helpers outside the sim folders.
export const SIM_DIRS = ['ai', 'combat', 'events', 'quest', 'saves'];
export const VIEW_PATHS = ['ai/view/', 'combat/view/', 'quest/view/', 'quest/view.ts'];
export const SHARD_SIM_DIRS = ['data', 'behaviour'];
const simAllow = JSON.parse(readFileSync(new URL('sim-closure.json', import.meta.url), 'utf8')).violations;
const simNoRender = rule('Headless simulation checks its complete runtime import closure (SF3a)', (context) => {
  if (!simRoot(pathOf(context))) return {};
  return { Program(node) {
    const marker = context.filename.replaceAll('\\', '/').lastIndexOf('/src/');
    const root = marker === -1 ? REPO : context.filename.slice(0, marker);
    for (const item of simClosure(root, [pathOf(context)])) {
      const allowance = root === REPO.replace(/\/$/u, '') ? simAllow[item.id]?.count ?? 0 : 0;
      if (item.count > allowance) report(context, node, `Simulation closure: ${item.id} (${item.count} > ${allowance}); ${item.trace.join(' → ')}`);
    }
  } };
});

// DS1.3: generator code runs only at build time. The shard's author entry composes local generators; runtime never
// imports them; check-chunks refuses a generator module in any built chunk, this catches the import that would put it there.
const GENERATOR = /^src\/shards\/[^/]+\/generators(?:\/|$)/u;
/** A shard's manual Node commands (lint/shard-layout.json bake/): offline like generators, and outside the map hash. */
const BAKE_COMMAND = /^src\/shards\/[^/]+\/bake\/.+\.(?:mjs|d\.mts)$/u;
const noRuntimeGenerator = rule('Generators are imported only by authoring entries, bakers and other generators (DS1.3)', (context) => {
  if (GENERATOR.test(pathOf(context)) || BAKE_COMMAND.test(pathOf(context))) return {};
  return importsVisitor((node) => {
    const source = importPrefix(node.source);
    if (source === null) return;
    const target = modulePath(context.filename, source), author = /^src\/shards\/([^/]+)\/shard\.config\.ts$/u.exec(pathOf(context));
    // The retained build entry may compose its own literal generators. Runtime/data/manifest imports still refuse.
    if (author !== null && !computedSpecifier(node.source) && target.startsWith(`src/shards/${author[1]}/generators/`)) return;
    if (GENERATOR.test(target)) report(context, node, 'Runtime code cannot import a generator: bake its output into data/ or public/assets/ instead');
  });
});

// A chain saves a prior `onFoo` hook and installs its own over it (`const prev = x.onFoo; x.onFoo = (…) => { prev?.(…); … }`):
// a saved hook whose name the same file also assigns. Reading a callback to call it (`const pick = v.onPick`) is no chain.
const noHookChain = rule('Hook chains migrate to typed events (E357)', (context) => {
  const saved = [], assigned = new Set();
  const hookName = (n) => { const v = unwrap(n); if (v?.type !== 'MemberExpression') return null; const name = propName(v) ?? stringOf(v.property) ?? ''; return /^on[A-Z]/u.test(name) ? name : null; };
  return {
    VariableDeclarator(node) { const name = hookName(node.init); if (name !== null) saved.push({ node, name }); },
    AssignmentExpression(node) { const name = hookName(node.left); if (name !== null) assigned.add(name); },
    'Program:exit'() { for (const { node, name } of saved) if (assigned.has(name)) report(context, node, `Use typed events instead of chaining the prior ${name} hook`); },
  };
});
const ACTIVE_SERVICES = new Set(['activeRegistry', 'activePhysics', 'activeBodies', 'activeClock', 'activeNavmesh', 'activeGrade', 'getAimTargets']);
const noActiveSingleton = rule('Active service reads migrate to the app (E357)', (context) => ({
  CallExpression(node) { if (ACTIVE_SERVICES.has(calleeName(node.callee))) report(context, node, 'Read the typed app service instead of an active singleton'); },
}));
const noActiveChunk = rule('Current content data belongs in the game layer (E357)', (context) => {
  if (/^src\/(?:client|cook|server|shared)\/game\/shard\//u.test(pathOf(context))) return {};
  return { CallExpression(node) { if (calleeName(node.callee) === 'getActiveChunk') report(context, node, 'Read explicit level data or the game content service'); } };
});

// Page overlays remain outside legacy level capture (legacyCapture's SHELL selector).
export const CAPTURE_SHELL_FILES = new Set(['Loading', 'Resume', 'RotateGate', 'Update', 'ReloadPrompt', 'ErrorModal', 'BootSettings', 'errorScreen'].map((name) => `src/client/engine/ui/${name}.ts`));
const CAPTURE_CALLS = new Set(['addEventListener', 'setTimeout', 'setInterval', 'requestAnimationFrame']);
const noGlobalListenerPatch = rule('Legacy global registrations migrate to explicit Scopes (E357 F11)', (context) => {
  const path = pathOf(context);
  if (/^src\/(?:client|cook|server|shared)\/engine\/app\//u.test(path) || CAPTURE_SHELL_FILES.has(path)) return {};
  return { CallExpression(node) {
    const callee = unwrap(node.callee);
    if (CAPTURE_CALLS.has(calleeName(callee))) {
      report(context, node, 'Register listeners and timers through the owning Scope'); return;
    }
    if (callee?.type !== 'MemberExpression' || !['append', 'appendChild'].includes(propName(callee) ?? stringOf(callee.property))) return;
    const target = unwrap(callee.object);
    if (target?.type === 'MemberExpression' && (propName(target) ?? stringOf(target.property)) === 'body' && nameOf(target.object) === 'document') {
      report(context, node, 'Register body nodes through the owning Scope');
    }
  } };
});

// E422: a test drives the real module through its seams (a class, a factory, an injected loader or port), never a
// replaced or reloaded module: vi.mock / doMock / resetModules / hoisted / importActual are refused in every test folder.
const MODULE_MOCKS = new Set(['mock', 'doMock', 'unmock', 'doUnmock', 'resetModules', 'hoisted', 'importActual', 'importMock']);
const noModuleMock = rule('Tests use seams, not module mocks (E422)', (context) => ({ CallExpression(node) {
  const callee = unwrap(node.callee);
  if (callee?.type !== 'MemberExpression') return;
  const object = unwrap(callee.object), name = propName(callee) ?? stringOf(callee.property);
  if (object?.type === 'Identifier' && object.name === 'vi' && MODULE_MOCKS.has(name)) report(context, node, `vi.${name} replaces or reloads a module: pass the dependency in (a class, a factory, an option) instead (E422)`);
} }));
const noRawAnimationMixer = rule('Animation mixers belong in engine/anim (E357 X4)', (context) => {
  // Offline Blender rig gates sample authored clips on CPU; they never install a runtime mixer.
  if (pathOf(context).startsWith('src/client/engine/anim/') || /^src\/shards\/[^/]+\/blender\/.+\.mjs$/u.test(pathOf(context))) return {};
  const names = new Set(['AnimationMixer']);
  const isMixer = (node) => {
    const value = unwrap(node);
    return value?.type === 'Identifier' ? names.has(value.name)
      : value?.type === 'MemberExpression' && (propName(value) ?? stringOf(value.property)) === 'AnimationMixer';
  };
  return {
    ImportDeclaration(node) {
      if (stringOf(node.source) !== 'three') return;
      for (const specifier of node.specifiers ?? []) if (specifier.type === 'ImportSpecifier' && nameOf(specifier.imported) === 'AnimationMixer') names.add(specifier.local.name);
    },
    VariableDeclarator(node) { if (node.id?.type === 'Identifier' && isMixer(node.init)) names.add(node.id.name); },
    NewExpression(node) { if (isMixer(node.callee)) report(context, node, 'Load a RigContract and use AnimMachine from engine/anim'); },
  };
});

const noInlineUiString = rule('Player-facing engine strings belong in the string table (E357 X8)', (context) => {
  if (!/^src\/(?:client|shared|server)\/engine\//u.test(pathOf(context))) return {};
  function check(value) {
    const node = unwrap(value);
    if (!node) return;
    if (node.type === 'Literal' && typeof node.value === 'string' && node.value !== '') report(context, node, 'Use engineString with a typed engine string key');
    else if (node.type === 'TemplateLiteral') report(context, node, 'Move the template to engine strings and pass its values as arguments');
    else if (node.type === 'ConditionalExpression') { check(node.consequent); check(node.alternate); }
    else if (node.type === 'LogicalExpression') check(node.right);
    else if (node.type === 'BinaryExpression' && node.operator === '+') { check(node.left); check(node.right); }
  }
  return {
    AssignmentExpression(node) { if (['textContent', 'innerText'].includes(propName(node.left) ?? stringOf(node.left?.property))) check(node.right); },
    Property(node) { if ((node.key?.name ?? stringOf(node.key)) === 'label') check(node.value); },
    CallExpression(node) { if (calleeName(node.callee) === 'toast') check(node.arguments[0]); },
  };
});

const noAuthoredHtml = rule('Shardfile-sourced and unknown text uses textContent, never HTML (SF58)', (context) => {
  if (!pathOf(context).startsWith('src/')) return {};
  let html = false;
  const sinks = new Set(['innerHTML', 'outerHTML', 'srcdoc', '__html', 'insertAdjacentHTML', 'createContextualFragment', 'write', 'writeln']);
  return {
    AssignmentExpression(node) {
      const left = unwrap(node.left);
      if (sinks.has(propName(left))) html = true;
    },
    MemberExpression(node) { if (sinks.has(propName(node))) html = true; },
    CallExpression(node) {
      const callee = unwrap(node.callee);
      if (sinks.has(calleeName(callee))) html = true;
    },
    Property(node) { if (sinks.has(node.key?.name ?? stringOf(node.key))) html = true; },
    Literal(node) { if (sinks.has(node.value)) html = true; },
    TemplateElement(node) { if (sinks.has(node.value.cooked)) html = true; },
    'Program:exit'(program) {
      // Comments and unrelated Object.assign calls do not establish an HTML
      // sink. Literal/template keys and aliasable sink references remain
      // conservative candidates for the full lexical provenance analysis.
      if (!html) return;
      for (const site of authoredHtmlSites(process.cwd(), context.filename, program)) context.report({ loc: { line: site.line, column: site.column }, message: site.message });
    },
  };
});

const noRawHud = rule('HUD nodes mount through scope-owned numbered slots (E357 X2)', (context) => {
  if (pathOf(context) === 'src/client/engine/ui/hudSlots.ts') return {};
  const aliases = new Set();
  /** @returns {boolean} */
  const hudTarget = (value) => {
    const node = unwrap(value);
    if (!node) return false;
    if (node.type === 'Identifier') return aliases.has(node.name);
    if (node.type === 'LogicalExpression' || node.type === 'ConditionalExpression') {
      return hudTarget(node.left ?? node.consequent) || hudTarget(node.right ?? node.alternate);
    }
    if (node.type === 'MemberExpression') {
      const property = propName(node) ?? stringOf(node.property);
      return property === 'hud' || (property === 'body' && nameOf(node.object) === 'document');
    }
    if (node.type === 'CallExpression') {
      const name = calleeName(node.callee);
      return (name === 'getElementById' && stringOf(node.arguments[0]) === 'hud')
        || (name === 'querySelector' && stringOf(node.arguments[0]) === '#hud');
    }
    return false;
  };
  return {
    VariableDeclarator(node) { if (node.id.type === 'Identifier' && hudTarget(node.init)) aliases.add(node.id.name); },
    CallExpression(node) {
      const callee = unwrap(node.callee);
      if (callee?.type === 'MemberExpression' && ['append', 'appendChild', 'prepend', 'insertBefore'].includes(propName(callee) ?? stringOf(callee.property)) && hudTarget(callee.object)) {
        report(context, node, 'Mount through ui.hud.widget(band, element, order, scope)');
      }
    },
  };
});

const LEVEL_FIELDS = new Set(['id', 'slug', 'levelId', 'kitLook', 'style', 'creatureStyle', 'look', 'biome']);
// E405 AG25: these names mean a level's identity or look on any receiver (`current.kitLook`).
const LEVEL_ONLY_FIELDS = new Set(['levelId', 'kitLook', 'creatureStyle']);
const LEVEL_NAMES = new Set(['level', 'spec', 'manifest', 'chunk', 'def']);
const noLevelIdentity = rule('Level identity and style dispatch belong in content data (E362 AG13, E405 AG25)', (context) => {
  if (pathOf(context).startsWith('src/shards/')) return {};
  const aliases = new Set(), tables = new Set(), lists = new Set(), fields = new Set(), strings = new Map();
  const levelValue = (raw) => {
    const n = unwrap(raw);
    return n?.type === 'Identifier' ? LEVEL_NAMES.has(n.name) || aliases.has(n.name)
      : n?.type === 'MemberExpression' ? (propName(n) ?? stringOf(n.property)) === 'level'
      : n?.type === 'CallExpression' && ['activeLevel', 'getActiveChunk'].includes(calleeName(n.callee));
  };
  const identity = (raw) => {
    const n = unwrap(raw);
    if (n?.type === 'Identifier') return fields.has(n.name);
    if (n?.type !== 'MemberExpression') return false;
    const field = propName(n) ?? stringOf(n.property);
    return LEVEL_ONLY_FIELDS.has(field) || (LEVEL_FIELDS.has(field) && levelValue(n.object));
  };
  const literal = (raw) => stringOf(raw) !== null || (unwrap(raw)?.type === 'Identifier' && strings.has(unwrap(raw).name));
  const stringList = (raw) => {
    const n = unwrap(raw);
    return n?.type === 'Identifier' ? lists.has(n.name) : n?.type === 'ArrayExpression' && n.elements.length > 0 && n.elements.every((e) => stringOf(e) !== null);
  };
  const hit = (node) => report(context, node, 'Pass capabilities or a data-provided strategy instead of dispatching on level identity/style');
  return {
    VariableDeclarator(node) {
      const init = unwrap(node.init);
      if (node.id.type === 'ObjectPattern' && levelValue(init)) {
        for (const p of node.id.properties) {
          const key = p.type === 'Property' ? (p.key?.name ?? stringOf(p.key)) : null;
          if (key !== null && LEVEL_FIELDS.has(key) && unwrap(p.value)?.type === 'Identifier') fields.add(unwrap(p.value).name);
        }
      }
      if (node.id.type !== 'Identifier') return;
      if (levelValue(init)) aliases.add(node.id.name);
      if (identity(init)) fields.add(node.id.name);
      if (stringOf(init) !== null) strings.set(node.id.name, stringOf(init));
      const topLevel = ['Program', 'ExportNamedDeclaration'].includes(node.parent?.parent?.type);
      if (topLevel && init?.type === 'ObjectExpression') tables.add(node.id.name);
      if (topLevel && init?.type === 'NewExpression' && ['Map', 'Set'].includes(nameOf(init.callee)) && unwrap(init.arguments[0])?.type === 'ArrayExpression') tables.add(node.id.name);
      if (topLevel && stringList(init)) lists.add(node.id.name);
    },
    BinaryExpression(node) {
      if (['===', '!==', '==', '!='].includes(node.operator) && ((identity(node.left) && literal(node.right)) || (identity(node.right) && literal(node.left)))) hit(node);
    },
    SwitchStatement(node) { if (identity(node.discriminant) && node.cases.some((c) => c.test && literal(c.test))) hit(node); },
    CallExpression(node) {
      const callee = unwrap(node.callee);
      if (callee?.type !== 'MemberExpression') return;
      const method = propName(callee) ?? stringOf(callee.property);
      const receiver = unwrap(callee.object), arg = node.arguments[0];
      if (['includes', 'startsWith', 'endsWith', 'indexOf', 'match'].includes(method)) {
        const styleTag = receiver?.type === 'MemberExpression' && (propName(receiver) ?? stringOf(receiver.property)) === 'tags' && levelValue(receiver.object) && ['ocean', 'toon', 'painterly', 'pbr'].includes(stringOf(arg));
        if (identity(receiver) || styleTag || (['includes', 'indexOf'].includes(method) && stringList(receiver) && identity(arg))) hit(node);
      } else if (['get', 'has'].includes(method) && identity(arg) && tables.has(nameOf(receiver))) hit(node);
      else if (method === 'test' && receiver?.type === 'Literal' && receiver.regex && identity(arg)) hit(node);
    },
    MemberExpression(node) { if (node.computed && identity(node.property) && (tables.has(nameOf(node.object)) || unwrap(node.object)?.type === 'ObjectExpression')) hit(node); },
  };
});

const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self']);
// E405 AG26 (Jake 2A): page-level document reach and bare window globals; building DOM (createElement) stays legal.
const PAGE_DOCUMENT = new Set(['body', 'head', 'title', 'documentElement', 'getElementById', 'querySelector', 'querySelectorAll', 'pointerLockElement', 'exitPointerLock', 'dispatchEvent']);
const BARE_GLOBALS = new Set(['innerWidth', 'innerHeight', 'devicePixelRatio', 'navigator', 'location']);
const globalObject = (raw) => { const n = unwrap(raw); return n?.type === 'Identifier' && GLOBAL_OBJECTS.has(n.name); };
const shardSandbox = rule('Shard services, globals, settings and assets stay inside their context (E362 AG11)', (context) => {
  const own = layerOf(pathOf(context));
  if (own?.name !== 'shards') return {};
  // G298: a shard's Node bakers (generators/**/*.mjs) are build tooling that moved in from scripts/; they never ship to the
  // client, so the sandbox (which guards what runs in a ShardContext) doesn't apply to them.
  if (/^src\/shards\/[^/]+\/generators\/.+\.m?js$/u.test(pathOf(context)) || BAKE_COMMAND.test(pathOf(context))) return {};
  const meta = shardWords.shards[own.slug] ?? { settings: [], assets: [] };
  const settings = new Set(meta.settings), globals = new Set(), documents = new Set(), strings = new Map();
  const text = (raw) => stringOf(raw) ?? (unwrap(raw)?.type === 'Identifier' ? strings.get(unwrap(raw).name) ?? null : null);
  const isGlobal = (raw) => globalObject(raw) || (unwrap(raw)?.type === 'Identifier' && globals.has(unwrap(raw).name));
  const isDocument = (raw) => nameOf(raw) === 'document' || documents.has(nameOf(raw));
  const assetPatterns = [...meta.assets, ...(shardWords.sharedAssets ?? [])].map((glob) => new RegExp(`^${glob.split('*').map(escapeRegex).join('.*')}$`, 'u'));
  const hit = (node, what) => report(context, node, `Shard sandbox: ${what}; use the owning ShardContext service`);
  return {
    ImportDeclaration(node) {
      for (const spec of node.specifiers) {
        if (spec.type !== 'ImportSpecifier') continue;
        const value = importedConst(context.filename, node.source.value, nameOf(spec.imported));
        if (value !== null) strings.set(spec.local.name, value);
      }
    },
    VariableDeclarator(node) {
      if (node.id.type !== 'Identifier') return;
      if (isGlobal(node.init)) globals.add(node.id.name);
      if (isDocument(node.init)) documents.add(node.id.name);
      const value = text(node.init);
      if (value !== null) strings.set(node.id.name, value);
    },
    MemberExpression(node) {
      if (isGlobal(node.object)) hit(node, 'global member access');
      else if (unwrap(node.object)?.type === 'Identifier' && isDocument(node.object) && PAGE_DOCUMENT.has(propName(node) ?? stringOf(node.property))) hit(node, `page-level document.${propName(node) ?? stringOf(node.property)}`);
    },
    Identifier(node) { if (BARE_GLOBALS.has(node.name) && isReference(node)) hit(node, `bare global ${node.name}`); },
    AssignmentExpression(node) { if (isGlobal(node.left)) hit(node, 'global write'); },
    CallExpression(node) {
      const name = calleeName(node.callee);
      if (['assign', 'defineProperty', 'defineProperties', 'set', 'deleteProperty'].includes(name) && isGlobal(node.arguments[0])) hit(node, 'global write');
      if (node.arguments.some((arg) => isGlobal(arg) || isDocument(arg)) && node.arguments.some((arg) => INPUT_EVENTS.has(text(arg)))) hit(node, 'global input listener');
      if (name === 'addEventListener' && (isGlobal(node.callee.object) || isDocument(node.callee.object)) && INPUT_EVENTS.has(text(node.arguments[0]))) hit(node, 'global input listener');
      if (name === 'setting' && !settings.has(text(node.arguments[0]))) hit(node, 'setting key is not owned by this shard');
    },
    Literal(node) {
      if (typeof node.value === 'string' && node.value.startsWith('/assets/') && !assetPatterns.some((pattern) => pattern.test(`public${node.value}`))) hit(node, 'asset path is not owned by this shard or the shared kit');
    },
    TemplateLiteral(node) {
      const prefix = node.quasis[0]?.value.cooked ?? '';
      if (prefix.startsWith('/assets/') && (node.expressions.length > 0 || !assetPatterns.some((pattern) => pattern.test(`public${prefix}`)))) hit(node, 'asset path must be statically owned');
    },
  };
});


// E405 LP3 / LP4: the game knows shards exist and holds the shared content (SF54: the kit's, too); it names no particular shard. The names
// come from the shards themselves (lint/shard-words.generated.json): slugs, display names, their camelCase forms, the
// distinctive slug stems, and the ids a shard declares in its own namespace. Comments are not counted.
const camelOf = (s) => s.toLowerCase().replaceAll(/[-\s]+([a-z])/gu, (_m, c) => c.toUpperCase());
const SHARD_DISPLAY = shardWords.words.filter((w) => /\s/u.test(w));
const COMMON_STEMS = new Set(['driftwood', 'far', 'nine', 'pine', 'blender', 'pastel']);   // ordinary words: shared content may say them
const SHARD_STEMS = [...new Set(shardWords.slugs.map((s) => s.split('-')[0] ?? ''))].filter((s) => s.length >= 6 && !COMMON_STEMS.has(s));
const SHARD_IDS = shardWords.words.filter((w) => w.includes('.') && !w.startsWith('weapon.'));
const SHARD_NAME_TERMS = [...shardWords.slugs, ...shardWords.slugs.map((s) => s.replaceAll('-', ' ')), ...SHARD_DISPLAY, ...shardWords.slugs.map(camelOf), ...SHARD_DISPLAY.map(camelOf), ...SHARD_STEMS, ...SHARD_IDS];
const SHARD_NAMES = new RegExp(`(?<![A-Za-z0-9])(?:${SHARD_NAME_TERMS.map(escapeRegex).join('|')})(?![A-Za-z0-9])`, 'iu');
// E362 AG6: the @wildshard/engine exports for the game and the composition root only (lint/engine-internal.json): the
// shards reach the engine's session, boot and installers through ShardContext, never by importing them.
const engineInternalFile = new URL('engine-internal.json', import.meta.url);
const engineInternal = new Set(existsSync(engineInternalFile) ? Object.keys(JSON.parse(readFileSync(engineInternalFile, 'utf8')).names) : []);
const engineInternalRule = rule('Game-only engine exports stay out of the shards (E362 AG6)', (context) => {
  if (!pathOf(context).startsWith('src/shards/')) return {};
  return { ImportDeclaration(node) {
    if (!(stringOf(node.source) ?? '').startsWith('@wildshard/engine/')) return; // any engine module (E434: no index)
    for (const s of node.specifiers ?? []) {
      const name = s.type === 'ImportSpecifier' ? nameOf(s.imported) : null;
      if (name !== null && engineInternal.has(name)) report(context, s, `${name} is the game's (lint/engine-internal.json): ask for a ShardContext verb instead`);
    }
  } };
});
// E362 AG12: a shard reaches the engine's page services through its ShardContext (ctx.app, ctx.hud, ctx.game, …),
// never by importing the singletons; types, classes, pure helpers and constants stay importable.
const SHARD_SERVICES = new Set(['app', 'saves', 'hudSlots', 'practiceRoom', 'lockOn']);
const shardServices = rule('Shards get engine services through ShardContext (E362 AG12)', (context) => {
  const filename = pathOf(context);
  if (!filename.startsWith('src/shards/')) return {};
  return { ImportDeclaration(node) {
    if (!(stringOf(node.source) ?? '').startsWith('@wildshard/engine/') || node.importKind === 'type') return; // any engine module (E434)
    for (const s of node.specifiers ?? []) {
      const name = s.type === 'ImportSpecifier' && s.importKind !== 'type' ? nameOf(s.imported) : null;
      if (name !== null && SHARD_SERVICES.has(name)) report(context, s, `${name} is a page service: use the ShardContext (ctx.app, ctx.hud …) instead of importing it`);
    }
  } };
});
const shardNames = rule('The game names no particular shard (E405 LAYER-PURITY)', (context) => {
  const own = layerOf(pathOf(context));
  if (own?.name !== 'game') return {};
  const check = (node, text) => {
    const m = SHARD_NAMES.exec(text);
    if (m) report(context, node, `Game code names a shard: ${m[0]} (it belongs in that shard's folder)`);
  };
  return {
    // an identifier's camelCase words (`nalatiFlags` → `nalati Flags`, `pineHollowMix` → `pine Hollow Mix`)
    Identifier(node) { check(node, node.name.replaceAll(/([a-z0-9])([A-Z])/gu, '$1 $2')); },
    Literal(node) { if (typeof node.value === 'string') check(node, node.value); },
    TemplateElement(node) { check(node, node.value.cooked ?? node.value.raw); },
  };
});

// E434 (Jake: "barrel files are the devil"): no module re-exports another of ours. An import names the module that
// defines the binding (`@wildshard/<layer>/<path>` across layers, a relative path within one); a package's public surface
// is its package.json `exports`. A re-export of a third-party module (a bundler shim) is not a barrel and passes.
const ownModule = (source) => typeof source === 'string' && (source.startsWith('.') || source.startsWith('@wildshard/'));
// SF54/G136: the author boundary is the SDK; existing direct game imports are shrink-only transition debt.
const shardGameImports = rule('Primary shards import the authoring SDK, not the game', (context) => {
  const local = /^src\/shards\/[^/]+\/(.+)$/u.exec(pathOf(context))?.[1];
  if (local === undefined) return {};
  const check = (node, source) => {
    if (shardGameImport(context.filename, source)) report(context, node, `Primary shards use SDK authoring imports, not game code: ${source}`);
  };
  return {
    ...importsVisitor(node => { check(node, importPrefix(node.source)); }),
    TSImportType(node) { check(node, importPrefix(node.source)); },
  };
});

// G307: report-only during SF76; the standalone report enables this same rule without changing hard guards.
const shardGamePlugins = rule('Trusted runtime imports only defining game plugin exports (G307)', (context) => {
  if (!/^src\/shards\/[^/]+\//u.test(pathOf(context))) return {};
  const check = (node, source, computed = false) => {
    // Load the same package surface used by public-index; no second list to drift.
    exported('@wildshard/game/shard/context');
    const reason = computed && shardGameImport(context.filename, source) ? 'game plugin module must be a literal exported path'
      : shardGameImport(context.filename, source) ? 'primary shards cannot import game plugins' : null;
    if (reason !== null) report(context, node, `G307: ${reason}: ${source}`);
  };
  return {
    ...importsVisitor(node => { check(node, importPrefix(node.source), computedSpecifier(node.source)); }),
    TSImportType(node) { check(node, importPrefix(node.source), computedSpecifier(node.source)); },
    TSExternalModuleReference(node) { check(node, importPrefix(node.expression)); },
    CallExpression(node) {
      if (node.callee.type === 'Identifier' && node.callee.name === 'require') check(node, importPrefix(node.arguments[0]), computedSpecifier(node.arguments[0]));
    },
  };
});

const boundaryVisitors = check => ({
  ...importsVisitor(node => { check(node,importPrefix(node.source),computedSpecifier(node.source)); }),
  TSImportType(node) { check(node,importPrefix(node.source),computedSpecifier(node.source)); },
  TSExternalModuleReference(node) { check(node,importPrefix(node.expression)); },
  CallExpression(node) {
    if(node.callee.type==='Identifier' && node.callee.name==='require')check(node,importPrefix(node.arguments[0]),computedSpecifier(node.arguments[0]));
  },
});

// G450: normal lint enforces today's file ceilings without the retired ratchet hook.
// Count mode emits every site for lint/ratchet.mjs and the source/runtime copier.
const shardfileDebt = existsSync(ratchetFile) ? JSON.parse(readFileSync(ratchetFile, 'utf8')) : {};
const shardHostCallback = {
  meta: { type: 'problem', docs: { description: 'Shard host APIs take data, not TS callbacks (G454)' },
    schema: [{ type: 'object', properties: { count: { type: 'boolean' } }, additionalProperties: false }] },
  create(context) {
    const file = pathOf(context);
    if (!file.startsWith('src/shards/')) return {};
    const index = context.filename.replaceAll('\\', '/').lastIndexOf('/src/');
    const root = index === -1 ? REPO : context.filename.slice(0, index);
    if (!hostPlayFile(root, file)) return {};
    const limit = context.options[0]?.count === true ? 0 : shardfileDebt['wildshard/no-shard-host-callback']?.[file] ?? 0;
    return { 'Program:exit'(program) {
      for (const issue of hostCallbackSites(root, file, program).slice(limit)) context.report({
        loc: { start: context.sourceCode.getLocFromIndex(issue.start), end: context.sourceCode.getLocFromIndex(issue.end) }, message: issue.message,
      });
    } };
  },
};
const shardfileBoundaryRule = name => ({
  meta: { type: 'problem', docs: { description: `Shardfile source boundary: ${name} (G450)` },
    schema: [{ type: 'object', properties: { count: { type: 'boolean' }, closedShards: { type: 'array', items: { type: 'string' }, uniqueItems: true } }, additionalProperties: false }] },
  create(context) {
    const file = pathOf(context);
    if (name === 'runtime-standalone') return {};
    const index = context.filename.replaceAll('\\', '/').lastIndexOf('/src/');
    const root = index === -1 ? REPO : context.filename.slice(0, index);
    const slug = /^src\/shards\/([^/]+)\//u.exec(file)?.[1];
    const closed = context.options[0]?.closedShards?.includes(slug) === true;
    const limit = closed || context.options[0]?.count === true ? 0 : shardfileDebt[`wildshard/${name}`]?.[file] ?? 0;
    let count = 0;
    return shardfileBoundaryVisitors(root, file, name, (node, message) => {
      count += 1;
      if (count > limit) report(context, node, message);
    });
  },
});

// Blender target sources are offline authoring, never app runtime. Keep the
// same exact script/source/post identities as check-model-sources; a folder
// named blender or an unregistered sibling grants no exemption.
const blenderTargetsFile = resolve(process.cwd(), 'scripts/blender/targets.json'); // Shard lint: blender sources left with the shards.
const blenderTargets = existsSync(blenderTargetsFile) ? JSON.parse(readFileSync(blenderTargetsFile, 'utf8')).targets : [];
const blenderSources = new Set();
for (const target of Object.values(blenderTargets)) for (const file of [target.script, target.post, ...(target.sources ?? [])])
  if (typeof file === 'string' && /^src\/shards\/[^/]+\/blender\/.+\.[cm]?[jt]sx?$/u.test(file)) blenderSources.add(file);

// F3: hard structural boundary. No count option or debt allowance exists.
const noShardRuntime = rule('Primary shards contain authoring and declarations only (G694 F3)', context => {
  const file = pathOf(context), local = /^src\/shards\/[^/]+\/(.+)$/u.exec(file)?.[1];
  if (local === undefined) return {};
  const allowed = local.startsWith('generators/') || BAKE_COMMAND.test(file) || blenderSources.has(file) || /(?:\.d|\.d\.json|\.generated)\.ts$/u.test(local);
  return {
    Program(node) {
      if (local === 'shard.config.ts' ? !declarationConfigProgram(node) : !allowed)
        report(context, node, 'Primary shard runtime source is forbidden; use generators/, registered Blender sources or erased declarations; shard.config.ts must be declaration-only');
    },
    ...boundaryVisitors((node, source) => {
      if (typeof source === 'string' && (/^@wildshard\/sharddev\/runtime(?:[/?#]|$)/u.test(source)
        || modulePath(context.filename, source).startsWith('src/sharddev/runtime/') || sharddevRuntimeImport(context.filename, source)))
        report(context, node, 'Primary shards cannot import trusted SDK runtime; emit admitted data or WASM instead');
    }),
  };
});

const generatorImports = rule('Generator and data imports stay on the authoring surface (DS0.3)', context => boundaryVisitors((node,source,computed)=>{
  const reason=(computed || source===null) && generatorImportViolation(context.filename,'<computed>')!==null
    ? 'author imports require a literal module path' : generatorImportViolation(context.filename,source);
  if(reason!==null)report(context,node,`${reason}: ${source}`);
}));

const shardEngineImports = rule('Direct shard engine imports shrink during the plugin migration (DS0.3)', context => {
  if(!pathOf(context).startsWith('src/shards/'))return {};
  return boundaryVisitors((node,source)=>{
    if(shardEngineImport(context.filename,source))report(context,node,`Direct engine import belongs to the plugin migration count: ${source}`);
  });
});

const sdkNoFacade = rule('The authoring SDK never aliases a game or engine runtime binding (G307)', context => {
  if(!/^src\/(?:sdk|sharddev)\//u.test(pathOf(context)))return {};
  return { Program(node) {
    const imported=new Map(), aliases=new Map(), candidates=[];
    const external=source=>shardGameImport(context.filename,source) || shardEngineImport(context.filename,source);
    const bindingNames=value=>{
      if(value?.type==='Identifier')return [value.name];
      if(value?.type==='RestElement')return bindingNames(value.argument);
      if(value?.type==='AssignmentPattern')return bindingNames(value.left);
      if(value?.type==='ArrayPattern')return value.elements.flatMap(bindingNames);
      if(value?.type==='ObjectPattern')return value.properties.flatMap(item=>bindingNames(item.type==='Property'?item.value:item));
      return [];
    };
    const reference=value=>{
      const n=unwrap(value);
      if(n?.type==='Identifier')return n.name;
      if(n?.type==='MemberExpression' || n?.type==='TSQualifiedName')return reference(n.object ?? n.left);
      if(n?.type==='TSTypeReference')return reference(n.typeName);
      if(n?.type==='TSTypeQuery')return reference(n.exprName);
      return null;
    };
    for(const statement of node.body) {
      if(statement.type==='ImportDeclaration' && external(importPrefix(statement.source))) {
        for(const item of statement.specifiers)imported.set(item.local.name,importPrefix(statement.source));
      }
      const declaration=statement.type==='ExportNamedDeclaration'?statement.declaration:statement;
      if(declaration?.type==='TSImportEqualsDeclaration' && external(importPrefix(declaration.moduleReference?.expression))) {
        imported.set(declaration.id.name,importPrefix(declaration.moduleReference.expression));
        if(statement.type==='ExportNamedDeclaration')candidates.push({node:declaration,name:declaration.id.name,ref:declaration.id.name});
      }
      if(declaration?.type==='VariableDeclaration')for(const item of declaration.declarations) {
        for(const name of bindingNames(item.id)) {
          aliases.set(name,reference(item.init));
          if(statement.type==='ExportNamedDeclaration')candidates.push({node:item,name,ref:reference(item.init)});
        }
      }
      if(declaration?.type==='TSTypeAliasDeclaration') {
        aliases.set(declaration.id.name,reference(declaration.typeAnnotation));
        if(statement.type==='ExportNamedDeclaration')candidates.push({node:declaration,name:declaration.id.name,ref:reference(declaration.typeAnnotation),source:declaration.typeAnnotation.type==='TSImportType'?importPrefix(declaration.typeAnnotation.source):null});
      }
      if(statement.type==='ExportNamedDeclaration' && statement.source && external(importPrefix(statement.source))) {
        candidates.push({node:statement,name:'re-export',source:importPrefix(statement.source)});
      } else if(statement.type==='ExportNamedDeclaration')for(const item of statement.specifiers ?? [])candidates.push({node:item,name:item.exported.name,ref:item.local.name});
      if(statement.type==='ExportAllDeclaration' && external(importPrefix(statement.source)))candidates.push({node:statement,name:'re-export',source:importPrefix(statement.source)});
      if(statement.type==='ExportDefaultDeclaration')candidates.push({node:statement,name:'default',ref:reference(statement.declaration)});
    }
    for(const candidate of candidates) {
      let ref=candidate.ref, source=candidate.source;
      const seen=new Set();
      while(typeof ref==='string' && !seen.has(ref)) {
        seen.add(ref);
        if(imported.has(ref)){source=imported.get(ref);break;}
        ref=aliases.get(ref);
      }
      if(typeof source==='string' && external(source))report(context,candidate.node,`Delete SDK facade ${candidate.name}; import the defining runtime module directly: ${source}`);
    }
  } };
});

const noReexport = rule('No barrels: no module re-exports one of ours (E434)', (context) => {
  if (!pathOf(context).startsWith('src/')) return {};
  const imported = new Set();
  const message = (what) => `${what}: import it from the module that defines it (E434: no barrels)`;
  return {
    ImportDeclaration(node) { if (ownModule(stringOf(node.source))) for (const s of node.specifiers ?? []) imported.add(s.local.name); },
    ExportAllDeclaration(node) { if (ownModule(stringOf(node.source))) report(context, node, message(`export * from '${stringOf(node.source)}'`)); },
    ExportNamedDeclaration(node) {
      if (node.source) { if (ownModule(stringOf(node.source))) report(context, node, message(`a re-export from '${stringOf(node.source)}'`)); return; }
      for (const s of node.specifiers ?? []) {
        const local = s.local?.name;
        if (local !== undefined && imported.has(local)) report(context, s, message(`export { ${local} } re-exports an imported binding`));
      }
    },
  };
});

const clientPlanReflection = rule('Client features cannot reflect into shard TS owners (G483)', context => {
  // Format's clientPlan.ts lives in the shardfile repo now; its registry here carries the check.
  if (pathOf(context) !== 'src/client/game/shardfile/clientPlan.ts') return {};
  return { Program(node) { for (const failure of clientPlanSchemaViolations(REPO)) report(context, node, failure); } };
});

// G645: test fixtures are not shipped player surfaces. Keep architecture and
// no-module-mock enforcement, and never let production import a test module.
export const TEST_DOMAIN_RUNTIME_RULES = [
  'no-url-switch', 'no-inline-ui-string', 'no-authored-html', 'engine-words',
  'shard-names', 'no-shard-branch', 'no-raw-save', 'no-raw-input',
  'no-global-listener-patch', 'no-raw-hud', 'no-raw-shader-patch',
  'no-raw-animation-mixer', 'no-renderer-type', 'no-active-singleton',
  'no-active-chunk', 'no-hook-chain', 'no-level-identity', 'sim-no-render',
  'runtime-performance', 'no-raw-random-time', 'no-runtime-generator',
];
/** @param {string} path */
const testFixtures = path => /^src\/(?:engine|game|sdk|sharddev)\/test\//u.test(path);
/** @param {string} path */
const testModule = path => path.endsWith('.test.ts') || testFixtures(path);
const testDomain = context => testModule(pathOf(context));
const noProductionTestImport = rule('Production cannot import a test module (G645)', context => {
  if (!pathOf(context).startsWith('src/') || testDomain(context)) return {};
  const check = node => {
    const source = importPrefix(node.source);
    if (source !== null && (/\.test(?:\.[cm]?[jt]s)?(?:[?#].*)?$/u.test(modulePath(context.filename, source))
      || testFixtures(modulePath(context.filename, source))))
      report(context, node, 'Production cannot import or re-export a test module');
  };
  return { ...importsVisitor(check), TSImportType: check };
});

const plugin = {
  meta: { name: 'wildshard' },
  rules: {
    'exec-max-buffer': execMaxBufferRule,
    'no-production-test-import': noProductionTestImport,
    'no-client-plan-reflection': clientPlanReflection,
    'explicit-schema-types': explicitSchemaTypes(shardfileDebt,pathOf),
    'no-base64': noBase64Rule(process.env.WILDSHARD_BASE64_FILE ?? BASE64_POLICY),
    // P1-E2: the engine ownership map (lint/engine-sides.json) and its shrink-only edge counts (lint/engine-side-edges.json)
    'engine-sides': engineSidesRule(process.env.WILDSHARD_ENGINE_SIDES_FILE ?? SIDES_FILE, process.env.WILDSHARD_ENGINE_SIDE_EDGES_FILE ?? SIDE_EDGES_FILE),
    'no-generated-import': noGeneratedImportRule(REPO, resolve(import.meta.dirname,'generated-import-debt.json')),
    'no-generated-json-import': noGeneratedJsonImportRule(REPO, shardfileDebt['wildshard/no-generated-json-import'] ?? {}),
    'no-reexport': noReexport,
    'shard-game-imports': shardGameImports,
    'shard-game-plugins': shardGamePlugins,
    'generator-imports': generatorImports,
    'no-shard-runtime': noShardRuntime,
    'shard-engine-imports': shardEngineImports,
    'sdk-no-facade': sdkNoFacade,
    'runtime-commons': runtimeCommons,
    'runtime-standalone': shardfileBoundaryRule('runtime-standalone'),
    'no-shard-host-callback': shardHostCallback,
    'no-build-time-import': shardfileBoundaryRule('no-build-time-import'),
    'no-runtime-in-build': shardfileBoundaryRule('no-runtime-in-build'),
    'runtime-performance': runtimePerformance,
    'no-url-switch': noUrlSwitch, layer, 'public-index': publicIndex, 'engine-words': engineWordsRule, 'no-shard-branch': noShardBranch, 'no-raw-save': noRawSave,
    'no-raw-random-time': noRawRandomTime, 'no-raw-input': noRawInput,
    'no-renderer-type': noRendererType, 'no-webgpu': noWebgpu, 'no-raw-shader-patch': noRawShaderPatch, 'sim-no-render': simNoRender,
    'no-runtime-generator': noRuntimeGenerator,
    'no-hook-chain': noHookChain,
    'no-active-singleton': noActiveSingleton, 'no-active-chunk': noActiveChunk,
    'no-global-listener-patch': noGlobalListenerPatch,
    'no-raw-hud': noRawHud,
    'no-inline-ui-string': noInlineUiString,
    'no-authored-html': noAuthoredHtml,
    'no-raw-animation-mixer': noRawAnimationMixer,
    'no-module-mock': noModuleMock,
    'no-level-identity': noLevelIdentity,
    'shard-sandbox': shardSandbox,
    'shard-names': shardNames,
    'engine-internal': engineInternalRule,
    'shard-services': shardServices,
  },
};
// L1: these nonzero migration counts previously ran only in the standalone
// census. Ordinary typed lint now enforces the same recorded file ceilings in
// its existing AST pass. Default census behavior and hard rules stay intact.
for(const name of ['no-raw-random-time','shard-sandbox','shard-game-imports','shard-game-plugins',
  'generator-imports','shard-engine-imports','sdk-no-facade']) {
  plugin.rules[name]=recordedDebtRule(plugin.rules[name],`wildshard/${name}`,shardfileDebt,pathOf);
}
for (const name of TEST_DOMAIN_RUNTIME_RULES) {
  const original = plugin.rules[name];
  plugin.rules[name] = { ...original, create(context) { return testDomain(context) ? {} : original.create(context); } };
}
export default plugin; // oxlint loads a JS plugin from its default export
