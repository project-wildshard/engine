// The commit lane's typecheck (HOW-WE-BUILD WL20): package.json's `typecheck`,
// over tracked and staged files only. Lanes share this checkout, so another
// lane's untracked scratch (a broken scripts/*.mjs, a half-written test) must
// not block your commit; it is not part of any commit yet.
//
// No untracked file in any tsconfig: the plain `pnpm run typecheck`. Otherwise
// each `tsc -p|-b <config>` in the script runs on an overlay config in
// .tsc-layers/commit/ that extends the real one and lists its files minus the
// untracked ones (references point at overlays too). The overlays keep the
// real outDir and tsBuildInfoFile, so the incremental build stays warm.
// Committed code importing an untracked file still fails in a composite
// project (TS6307: not listed in the project).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TSC = /(?:^|\/)tsc6?$/u;
const CONFIG_FLAG = new Set(['-p', '--project', '-b', '--build']);

/** Untracked, not ignored files (absolute paths). Staged new files are tracked. */
export function untrackedFiles(root) {
  const out = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (out.status !== 0) throw new Error(`git ls-files failed: ${out.stderr}`);
  return new Set(out.stdout.split('\0').filter(Boolean).map((path) => resolve(root, path)));
}

/** Expand `pnpm <script>` segments into the shell segments they run. */
export function typecheckSegments(scripts, name = 'typecheck', seen = new Set()) {
  if (seen.has(name)) throw new Error(`script cycle at ${name}`);
  const body = scripts[name];
  if (typeof body !== 'string') throw new Error(`no package.json script "${name}"`);
  return body.split('&&').map((part) => part.trim()).flatMap((part) => {
    const words = part.split(/\s+/u);
    const inner = words[0] === 'pnpm' ? (words[1] === 'run' ? words[2] : words[1]) : undefined;
    if (inner !== undefined && words.length <= (words[1] === 'run' ? 3 : 2) && typeof scripts[inner] === 'string') {
      return typecheckSegments(scripts, inner, new Set([...seen, name]));
    }
    return [part];
  });
}

/** The config a `tsc -p|-b <config>` segment names, as [wordIndex, path], or null. */
export function tscConfig(segment) {
  const words = segment.split(/\s+/u);
  const at = words.findIndex((word) => TSC.test(word));
  if (at < 0) return null;
  const flag = words.findIndex((word, index) => index > at && CONFIG_FLAG.has(word));
  return flag < 0 || words[flag + 1] === undefined ? null : [flag + 1, words[flag + 1]];
}

const configFile = (path) => (existsSync(path) && statSync(path).isDirectory() ? join(path, 'tsconfig.json') : path);

/**
 * Write overlays for `config` and every project it references. Returns the
 * overlay path for `config`, and whether any project dropped an untracked file.
 */
export function writeOverlays(ts, root, config, untracked, outDir = join(root, '.tsc-layers', 'commit')) {
  const done = new Map();
  let dropped = 0;
  const visit = (path) => {
    const real = configFile(resolve(path));
    const known = done.get(real);
    if (known !== undefined) return known;
    const overlay = join(outDir, `${relative(root, real).replaceAll('/', '__').replace(/^\.+/u, '')}`);
    done.set(real, overlay);
    const parsed = ts.getParsedCommandLineOfConfigFile(real, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
    if (parsed === undefined) throw new Error(`cannot read ${real}`);
    const kept = parsed.fileNames.filter((file) => !untracked.has(resolve(file)));
    dropped += parsed.fileNames.length - kept.length;
    const references = (parsed.projectReferences ?? []).map((ref) => ({ path: visit(ref.path) }));
    // A composite project's default rootDir is its config's folder; the
    // overlay lives elsewhere, so pin it to the real one.
    const compilerOptions = parsed.options.composite === true && parsed.options.rootDir === undefined ? { rootDir: dirname(real) } : {};
    const body = { extends: real, compilerOptions, files: kept, include: [], references };
    const text = `${JSON.stringify(body, null, 2)}\n`;
    mkdirSync(outDir, { recursive: true });
    // Rewrite only on change: tsc -b treats a newer config as out of date.
    if (!existsSync(overlay) || readFileSync(overlay, 'utf8') !== text) writeFileSync(overlay, text);
    return overlay;
  };
  const overlay = visit(resolve(root, config));
  return { overlay, dropped };
}

/** Run the typecheck. Returns the exit code. */
export function commitTypecheck(root, { env = process.env, stdio = 'inherit' } = {}) {
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {};
  const untracked = untrackedFiles(root);
  const segments = typecheckSegments(scripts);
  // pnpm run put node_modules/.bin on PATH (npr lives there); a plain shell does not.
  const PATH = [join(root, 'node_modules', '.bin'), env.PATH].filter(Boolean).join(delimiter);
  const run = (command) => spawnSync(command, { cwd: root, env: { ...env, PATH }, stdio, shell: true }).status ?? 1;
  if (untracked.size === 0) return run(segments.join(' && '));
  // Config parsing only, so the JS API of TS 6 serves the native tsc 7 too.
  const require = createRequire(join(root, 'package.json'));
  let ts;
  const typescript = () => (ts ??= (() => { try { return require('@typescript/typescript6'); } catch { return require('typescript'); } })());
  // Overlays are written per segment, just before it runs: an earlier step
  // (gen:inputs) may write files a later config picks up.
  let skipped = 0;
  for (const segment of segments) {
    const found = tscConfig(segment);
    let command = segment;
    if (found !== null) {
      const { overlay, dropped } = writeOverlays(typescript(), root, found[1], untracked);
      skipped += dropped;
      const words = segment.split(/\s+/u);
      words[found[0]] = overlay;
      command = words.join(' ');
    }
    const code = run(command);
    if (code !== 0) return code;
  }
  if (skipped > 0) console.error(`  - typecheck skipped ${skipped} untracked file(s) (not in this commit)`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim() || dirname(fileURLToPath(import.meta.url));
  process.exit(commitTypecheck(root));
}
