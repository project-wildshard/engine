// Script-path guard (meta QA 11-25 row 82, J505). A layout move (the lean move put shard tools under src/scripts) left
// scripts pointing where nothing is: a ROOT one level off, an import of a file that never came across, a read of art that
// stayed behind, a browser tool whose repo installs no playwright. Each failed only when someone ran it. The push lane
// (run-checks.mjs) checks every tracked script under a `scripts/` folder or `proofs/`:
//   (a) import: a relative import (`from './x.mjs'`, `import('../y.mjs')`) names a file that exists;
//   (b) package: a bare import names a package its nearest package.json declares (any dependency kind), its own name,
//       or a Node builtin;
//   (c) root: a `ROOT` (or `REPO`, `REPO_ROOT`) built from import.meta (`new URL('../..', import.meta.url)`,
//       `join(import.meta.dirname, '..', '..')`) is the folder of the script's nearest package.json;
//   (d) path: a literal joined to that anchored root (`join(ROOT, 'art/x')`, `resolve(ROOT, flag('cameras', 'art/x'))`)
//       whose first folder the repo has exists; a ROOT from process.cwd() or a flag is the caller's tree, not judged (outputs under tmp/, progress/, out/, dist/ are not read, nor a path the
//       script checks with existsSync first or makes with mkdirSync).
// Code inside strings is not this file's code: a template literal (nested ones too) and a quoted string that can't be a
// module name (a `node -e` source, a worker body) are blanked first. A line that names a file the build writes beside
// the script says so in a comment, `// script-paths: <why>`, and is not judged. A missing target the repo's .gitignore
// covers is a build output (a `*.generated.ts`, a copied wasm), so a fresh checkout and a built one get one verdict.
// Findings are lines (`<file>: <check> <what>`). The repo's own baseline, `.githooks/script-paths.baseline.json` (never
// stamped), lists the ones it still carries; it may only shrink. A repo with no baseline is report-only: its findings
// print and the push passes, until `--write` records them.
//   node .githooks/script-paths.mjs [--write | --prune]   (exit 1 when refused)
// Bypass in the push lane: SKIP_SCRIPT_PATHS=1 (J381).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BASELINE = '.githooks/script-paths.baseline.json';
const SCRIPT = /\.(?:[cm]?js)$/u;
const IN_SCOPE = /(?:^|\/)scripts\/|^proofs\//u;
const SKIP = ['project/', 'leftover/', 'node_modules/'];
const OUTPUTS = new Set(['tmp', 'progress', 'out', 'dist', 'build', '.cache', 'coverage']);
const BUILTIN = new Set(builtinModules);
/** A relative specifier names a file as written, or (a TypeScript-style import) with one of these endings. */
const SPECIFIER = /^[\w@./:#+~-]+$/u;
const RESOLVES = ['','.ts', '.mts', '.mjs', '.js', '/index.ts', '/index.mjs', '/index.js'];
const ROOT_NAME = '(?:ROOT|REPO|REPO_ROOT)';
const IMPORT = /(?<![\w.$'"`-])(?:from\s*|import\s*\(\s*|import\s+)['"]([^'"\s]+)['"]/gu;
const ANCHOR = new RegExp(`\\bconst\\s+(${ROOT_NAME})\\s*=\\s*([^;\\n]*import\\.meta[^;\\n]*)`, 'u');
const JOINED = new RegExp(`\\b(?:join|resolve|resolvePath|pathResolve)\\(\\s*${ROOT_NAME}\\s*,\\s*(?:flag\\(\\s*['"][^'"]+['"]\\s*,\\s*)?['"]([^'"$\`\\n]+)['"]`, 'gu');

/** A text with its comments blanked (line lengths kept), so a path in prose is never read as code. @param {string} text */
function code(text) {
  return text.replaceAll(/\/\*[\s\S]*?\*\//gu, blank).replaceAll(/(^|[^:'"`\\])(\/\/[^\n]*)/gmu, (_, before, comment) => `${before}${blank(comment)}`);
}

/** @param {string} text */
function blank(text) {
  return text.replaceAll(/[^\n]/gu, ' ');
}

/** The text with every template literal (nested ones too) and every quoted string that can't be a module name blanked,
 *  offsets kept: a script's `node -e` source or generated code (an import inside a string) is not this file's import.
 *  @param {string} text */
export function statements(text) {
  const chars = text.split('');
  const wipe = (/** @type {number} */ from, /** @type {number} */ to) => {
    for (let k = from; k < Math.min(to, chars.length); k++) if (chars[k] !== '\n') chars[k] = ' ';
  };
  /** @type {number[]} open braces inside each `${…}` we are in */
  const depth = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== ch && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      if (!SPECIFIER.test(text.slice(i + 1, j))) wipe(i, j + 1);
      i = j + 1;
    } else if (ch === '`' || (ch === '}' && depth.at(-1) === 0)) {
      if (ch === '}') depth.pop();
      let j = i + 1;
      while (j < text.length && text[j] !== '`' && !(text[j] === '$' && text[j + 1] === '{')) j += text[j] === '\\' ? 2 : 1;
      wipe(i, j + 1);
      if (text[j] === '$') {
        depth.push(0);
        i = j + 2;
      } else i = j + 1;
    } else {
      if (ch === '{' && depth.length > 0) depth[depth.length - 1]++;
      else if (ch === '}' && depth.length > 0) depth[depth.length - 1]--;
      i++;
    }
  }
  return chars.join('');
}

/** Whether the path joined at `at` is one the script checks with existsSync first or makes with mkdirSync (an output):
 *  on its own line, or through the const it is assigned to. @param {string} text @param {number} at */
function optional(text, at) {
  const start = text.lastIndexOf('\n', at) + 1, end = text.indexOf('\n', at);
  if (/\b(?:existsSync|mkdirSync)\(/u.test(text.slice(start, end === -1 ? undefined : end))) return true;
  const name = /\bconst\s+(\w+)\s*=\s*$/u.exec(text.slice(start, at))?.[1];
  return name !== undefined && new RegExp(`(?:existsSync|mkdirSync)\\(\\s*${name}\\s*[,)]`, 'u').test(text);
}

/** The package name of a bare specifier (`@scope/name/x` is `@scope/name`). @param {string} spec */
function packageOf(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** The folder a `ROOT = …import.meta…` expression names, relative to the repo, or null when it is no plain form.
 *  @param {string} file the script's repo path @param {string} expression */
export function anchorOf(file, expression) {
  const here = posix.dirname(file);
  const url = /new URL\(\s*['"]([./]+)['"]\s*,\s*import\.meta\.url\s*\)/u.exec(expression);
  const tidy = (/** @type {string} */ path) => posix.normalize(path).replace(/\/$/u, '') || '.';
  if (url !== null) return tidy(posix.join(here, url[1]));
  const joined = /\b(?:join|resolve|resolvePath|pathResolve)\(\s*import\.meta\.dirname((?:\s*,\s*['"]\.\.['"])*)\s*\)/u.exec(expression);
  if (joined !== null) return tidy(posix.join(here, ...(joined[1].match(/\.\./gu) ?? [])));
  return null;
}

/**
 * Every finding in the given scripts.
 * @param {{ paths: string[], read: (path: string) => string, exists: (path: string) => boolean, ignored?: (path: string) => boolean }} repo
 *   `paths` are the tracked repo paths; `exists` answers for a repo path (a file or a folder); `ignored` for one .gitignore covers.
 * @returns {string[]}
 */
export function scriptPathFindings({ paths, read, exists: on, ignored = () => false }) {
  const exists = (/** @type {string} */ path) => on(path) || ignored(path);
  const tops = new Set(paths.map((path) => path.split('/')[0]));
  /** @type {Map<string, { dir: string, names: Set<string> }>} */
  const packages = new Map();
  /** The nearest package.json above a repo path: its folder and the names it may import. @param {string} file */
  const packageFor = (file) => {
    for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
      const at = dir === '.' ? 'package.json' : `${dir}/package.json`;
      if (exists(at)) {
        if (!packages.has(at)) {
          const manifest = JSON.parse(read(at));
          const names = new Set([manifest.name, ...['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((kind) => Object.keys(manifest[kind] ?? {}))]);
          packages.set(at, { dir, names });
        }
        return packages.get(at);
      }
      if (dir === '.') return null;
    }
  };
  const findings = [];
  for (const file of [...paths].sort()) {
    if (!SCRIPT.test(file) || !IN_SCOPE.test(file) || SKIP.some((prefix) => file.startsWith(prefix)) || file.includes('/fixtures/')) continue;
    let raw;
    try {
      raw = read(file);
    } catch {
      continue;
    }
    const text = code(raw), lines = raw.split('\n');
    /** The raw line holding an offset. @param {number} at */
    const lineAt = (at) => lines[raw.slice(0, at).split('\n').length - 1] ?? '';
    const marked = (/** @type {number} */ at) => /\/[/*]\s*script-paths:/u.test(lineAt(at));
    const pkg = packageFor(file);
    for (const { 1: spec, index } of statements(text).matchAll(IMPORT)) {
      if (!SPECIFIER.test(spec) || marked(index)) continue; // a regex or a pattern in the code, not a module name
      if (spec.startsWith('.')) {
        const target = posix.normalize(posix.join(posix.dirname(file), spec));
        if (!RESOLVES.some((ending) => exists(`${target}${ending}`))) findings.push(`${file}: import ${spec} (no ${target})`);
      } else if (!spec.startsWith('node:') && !spec.startsWith('#') &&!BUILTIN.has(spec) && !spec.includes('${') && pkg !== null && !pkg.names.has(packageOf(spec))) {
        findings.push(`${file}: package ${packageOf(spec)} (not in ${pkg.dir === '.' ? '' : `${pkg.dir}/`}package.json)`);
      }
    }
    const anchor = ANCHOR.exec(text);
    const root = anchor === null ? null : anchorOf(file, anchor[2]);
    if (anchor !== null && root !== null && pkg !== null && root !== pkg.dir) {
      findings.push(`${file}: root ${anchor[1]} is ${root === '.' ? 'the repo root' : root}, not the package root ${pkg.dir === '.' ? '(the repo root)' : pkg.dir}`);
    }
    for (const { 1: literal, index } of text.matchAll(JOINED)) {
      const first = literal.split('/')[0];
      if (OUTPUTS.has(first) || literal.startsWith('/') || literal.startsWith('.') || marked(index) || optional(text, index)) continue;
      if (root === null) continue;
      if (root === '.' && !tops.has(first)) continue;
      const target = posix.normalize(posix.join(root, literal));
      if (!exists(target)) findings.push(`${file}: path ${literal} (no ${target})`);
    }
  }
  return [...new Set(findings)];
}

/** Compare with the shrink-only baseline. @param {string[]} found @param {string[]} baseline */
export function judge(found, baseline) {
  const known = new Set(baseline), now = new Set(found);
  return { added: found.filter((line) => !known.has(line)), shrunk: baseline.filter((line) => !now.has(line)) };
}

/** The repo at `root`, judged: its tracked scripts against its baseline. @param {string} root */
export function scriptPathsVerdict(root) {
  const paths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\0').filter(Boolean);
  const ignored = (/** @type {string} */ path) => {
    try {
      execFileSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: root, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  const found = scriptPathFindings({ paths, read: (path) => readFileSync(join(root, path), 'utf8'), exists: (path) => existsSync(join(root, path)), ignored });
  const file = join(root, BASELINE), recorded = existsSync(file);
  /** @type {string[]} */
  const baseline = recorded ? JSON.parse(readFileSync(file, 'utf8')).findings ?? [] : [];
  return { found, baseline, enforced: recorded, ...judge(found, baseline) };
}

/** The refusal's text. @param {string[]} added */
export function refusal(added) {
  return `script-paths (meta QA 11-25 row 82): a script points where nothing is; fix the path, or declare the package:\n${added.map((line) => `  ${line}`).join('\n')}`;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const { found, baseline, enforced, added, shrunk } = scriptPathsVerdict(root);
  const write = process.argv.includes('--write');
  if (write || process.argv.includes('--prune')) {
    const findings = write ? found : baseline.filter((line) => found.includes(line));
    mkdirSync(dirname(join(root, BASELINE)), { recursive: true });
    writeFileSync(join(root, BASELINE), `${JSON.stringify({ about: 'meta QA 11-25 row 82: script paths that point where nothing is, still carried; shrink only (node .githooks/script-paths.mjs --prune).', findings }, null, 1)}\n`);
    console.log(`script-paths: baseline written, ${findings.length} finding(s)`);
  } else if (shrunk.length > 0) {
    console.log(`script-paths: ${shrunk.length} baselined finding(s) are gone; run node .githooks/script-paths.mjs --prune and commit it`);
  }
  if (added.length > 0 && !write && enforced) {
    console.error(refusal(added));
    process.exitCode = 1;
  } else if (added.length > 0 && !write) {
    console.log(`script-paths: report only (no ${BASELINE} yet):\n${added.map((line) => `  ${line}`).join('\n')}`);
  } else {
    console.log(`script-paths: ${found.length} baselined finding(s), none new`);
  }
}
