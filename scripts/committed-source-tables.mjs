// G798: source regeneration/checking against one immutable Git tree. It never
// writes a working output; callers own staging or comparison of returned text.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gitSourceView, installGitSourceView } from './git-source-view.mjs';

const nativeRead = readFileSync, root = realpathSync(process.cwd());
const top = realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim());
if (top !== root) throw new Error('Committed source tables require the checkout root');
const args = process.argv.slice(2), check = args.includes('--check'), published = args.includes('--after-publication');
if (args.some(arg => !['--check', '--after-publication'].includes(arg) && !arg.startsWith('--tree=') && !arg.startsWith('--changed=')) || args.filter(arg => arg.startsWith('--tree=')).length > 1 || args.filter(arg => arg === '--check').length > 1 || args.filter(arg => arg === '--after-publication').length > 1) throw new Error('Expected optional --check, --after-publication, --tree=<oid> and --changed=<path>');
if (published && (!check || args.some(arg => arg.startsWith('--tree=') || arg.startsWith('--changed=')))) throw new Error('Publication checks require complete HEAD source checking');
// Run artifact admission before installing the immutable source view, in a
// separate process so its native formatter imports cannot poison source reads.
/** @type {Record<string,string>} */
let artifactTables = {};
if (published) {
  const result = JSON.parse(execFileSync(process.execPath, ['scripts/boot-publication-proof.mjs'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
  const paths = ['src/client/game/boot/bytes.generated.ts', 'src/client/game/boot/versions.generated.ts', 'src/client/game/boot/packs.generated.ts'];
  if (result === null || typeof result !== 'object' || Array.isArray(result) || JSON.stringify(Object.keys(result).sort()) !== JSON.stringify(paths.sort()) || Object.values(result).some(value => typeof value !== 'string')) throw new Error('Invalid verified publication table set');
  artifactTables = result;
}
const supplied = args.find(arg => arg.startsWith('--tree='))?.slice('--tree='.length);
const tree = supplied ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(tree)) throw new Error('Committed source tree must be an exact object identity');
const view = gitSourceView(root, tree);
installGitSourceView(view);
const { sourceTableTexts } = /** @type {typeof import('./gen-source.mjs')} */ (await import(pathToFileURL(resolve(root, 'scripts/gen-source.mjs')).href));
const changed = args.filter(arg => arg.startsWith('--changed=')).map(arg => arg.slice('--changed='.length));
const texts = await sourceTableTexts(root, { committed: true, ...(changed.length > 0 ? { changed } : {}) });
if (published && Object.keys(artifactTables).some(path => !Object.hasOwn(texts, path))) throw new Error('Publication tables lack registered source owners');
if (check) {
  for (const [path, source] of Object.entries(texts)) {
    // A preceding generator may already have repaired the working output.
    // Its success cannot hide a stale checked-in table from this source gate.
    if (view.read(path).toString('utf8') !== source) throw new Error(`Committed source table is stale: ${path}`);
    /** @type {string|undefined} */
    let actual;
    try { actual = nativeRead(resolve(root, path), 'utf8'); } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
    if (actual !== (artifactTables[path] ?? source)) throw new Error(`Committed source output differs: ${path}`);
  }
  console.log(`gen:source: ${Object.keys(texts).length} outputs match exact committed inputs`);
} else console.log(`gen:source texts ${JSON.stringify(texts)}`);
