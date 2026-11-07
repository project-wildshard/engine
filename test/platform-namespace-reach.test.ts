import { expect, it } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Isolated filesystem fixtures exercise the source census.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Each census fixture owns a temporary directory.
import { tmpdir } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Construct confined fixture paths.
import { dirname, join } from 'node:path';
import { sourceProgressInventory } from '../scripts/shard-platform.mjs';
import {platformOutput} from './fixtures/platformOutputs';

function charges(loader: string, initialization = '', shell = '', shellRoot = 'src/client/app/entry.ts', pineMember = 'createAmbientLife'): string[] {
  const root = mkdtempSync(join(tmpdir(), 'platform-namespace-'));
  const put = (file: string, text: string): void => { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
  try {
    put('src/game/package.json', JSON.stringify({ name: '@wildshard/game', exports: { './plugin/ui': './client/plugin/ui.ts', './model': './client/model.ts' } }));
    put('src/client/game/plugin/ui.ts', `export function forestHelper() { return 1; }\nexport function createAmbientLife() { return forestHelper(); }\nexport function borrowedNpcSpecimen() { return 2; }\nexport function enterGrid() { return 3; }\n${initialization}`);
    put('src/client/game/model.ts', loader);
    if (shell !== '') put(shellRoot, shell);
    platformOutput(root,'pine-hollow',{'runtime/index.ts': `import { ${pineMember} } from '@wildshard/engine/game/plugin/ui'; export const life = ${pineMember}();`});
    platformOutput(root,'driftwood-isle',{'runtime/index.ts': "import { modelCatalogue } from '@wildshard/engine/game/model'; export const model = modelCatalogue;"});
    // LD10: a product ships no runtime TypeScript, so authored runtime roots its G294 users on the source basis
    const row = sourceProgressInventory(root)['pine-hollow'];
    if (row === undefined) throw new Error('Pine measurement absent');
    return row.conversion.gameSystemAttribution.exports.filter(entry => entry.path === 'src/client/game/plugin/ui.ts').map(entry => entry.name);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

it('charges private bodies through named static and local dynamic namespace members', () => {
  for (const loader of [
    "import * as ui from './plugin/ui'; export function modelCatalogue() { return ui.borrowedNpcSpecimen(); }",
    "export async function modelCatalogue() { const renderer = await import('./plugin/ui'); return renderer.borrowedNpcSpecimen(); }",
    "export async function modelCatalogue() { const renderer = await import('./plugin/ui'); return renderer['borrowedNpcSpecimen'](); }",
    "export async function modelCatalogue() { const { borrowedNpcSpecimen: borrowed } = await import('./plugin/ui'); return borrowed(); }",
    "export async function modelCatalogue() { return (await import('./plugin/ui')).borrowedNpcSpecimen(); }",
  ]) expect(charges(loader)).toEqual(expect.arrayContaining(['createAmbientLife', 'forestHelper']));
});

it('conservatively reaches all exports when a namespace escapes or its member is unknown', () => {
  for (const body of [
    'return consume(renderer);', 'return {...renderer};', 'return renderer[key];', 'return renderer;',
  ]) expect(charges(`export async function modelCatalogue(consume, key) { const renderer = await import('./plugin/ui'); ${body} }`)).not.toContain('createAmbientLife');
});

it('keeps imported module initialization live without reaching every export', () => {
  const names = charges("export async function modelCatalogue() { const renderer = await import('./plugin/ui'); return 0; }", 'forestHelper();');
  expect(names).toContain('createAmbientLife');
  expect(names).not.toContain('forestHelper');
});

it('keeps an exported dynamic namespace conservative', () => {
  expect(charges("export const modelCatalogue = import('./plugin/ui');")).not.toContain('createAmbientLife');
});

it('keeps rest and unknown-key destructuring conservative', () => {
  for (const pattern of ['{...rest}', '{[key]: value}']) expect(charges(`export async function modelCatalogue(key) { const ${pattern} = await import('./plugin/ui'); }`)).not.toContain('createAmbientLife');
});

it('does not confuse an import promise with the resolved namespace', () => {
  expect(charges("export function modelCatalogue() { const pending = import('./plugin/ui'); return pending.then(module => module); }")).not.toContain('createAmbientLife');
  expect(charges("export function modelCatalogue() { return import('./plugin/ui').then(module => module); }")).not.toContain('createAmbientLife');
});

it('narrows resolved Promise.all tuple namespaces without losing module initialization', () => {
  expect(charges("export async function modelCatalogue() { const [{ borrowedNpcSpecimen }] = await Promise.all([import('./plugin/ui')]); return borrowedNpcSpecimen(); }")).toEqual(expect.arrayContaining(['createAmbientLife', 'forestHelper']));
  const names = charges("export async function modelCatalogue() { const [other, { borrowedNpcSpecimen: borrowed }] = await Promise.all([Promise.resolve(0), import('./plugin/ui')]); return borrowed(); }", 'forestHelper();');
  expect(names).toContain('createAmbientLife');
  expect(names).not.toContain('forestHelper');
});

it('keeps ambiguous Promise.all tuple namespaces conservative', () => {
  for (const loader of [
    "export async function modelCatalogue(key) { const [{...rest}] = await Promise.all([import('./plugin/ui')]); return rest; }",
    "export async function modelCatalogue(key) { const [{[key]: value}] = await Promise.all([import('./plugin/ui')]); return value; }",
    "export async function modelCatalogue() { const [namespace] = await Promise.all([import('./plugin/ui')]); return namespace; }",
    "export async function modelCatalogue() { const [...rest] = await Promise.all([import('./plugin/ui')]); return rest; }",
    "export async function modelCatalogue(other) { const [{ borrowedNpcSpecimen }] = await Promise.all([...other, import('./plugin/ui')]); return borrowedNpcSpecimen; }",
  ]) expect(charges(loader)).not.toContain('createAmbientLife');
});

it('counts named shell use without concealing shard-only UI exports', () => {
  const loader = "export function modelCatalogue() { return 0; }";
  expect(charges(loader, '', "import { borrowedNpcSpecimen } from '@wildshard/engine/game/plugin/ui'; borrowedNpcSpecimen();")).toEqual(expect.arrayContaining(['createAmbientLife', 'forestHelper']));
  expect(charges(loader, '', "import { createAmbientLife } from '@wildshard/engine/game/plugin/ui'; createAmbientLife();")).toContain('createAmbientLife');
});

it('narrows shell retry loads without making content shared', () => {
  const loader = "export async function modelCatalogue() { const ui = await import('./plugin/ui'); return ui.borrowedNpcSpecimen(); }";
  const shell = "import { retried } from '@wildshard/engine/boot/retry'; async function start() { const [{ enterGrid }] = await retried(() => Promise.all([import('@wildshard/engine/game/plugin/ui')])); return enterGrid(); } start();";
  expect(charges(loader, '', shell)).toEqual(expect.arrayContaining(['createAmbientLife', 'forestHelper']));
  expect(charges(loader, '', shell, 'src/client/app/entry.ts', 'enterGrid')).not.toContain('enterGrid');
  expect(charges(loader, '', '', 'src/client/app/entry.ts', 'enterGrid')).toContain('enterGrid');
});

it('does not treat an arbitrary loader wrapper as result preserving', () => {
  expect(charges("export async function modelCatalogue(wrap) { const { borrowedNpcSpecimen } = await wrap(() => import('./plugin/ui')); return borrowedNpcSpecimen(); }")).not.toContain('createAmbientLife');
});

it('never counts a shell import of a shard as an independent content user', () => {
  expect(charges("export async function modelCatalogue() { const ui = await import('./plugin/ui'); return ui.borrowedNpcSpecimen(); }", '', "import './shards/pine-hollow/runtime';")).toEqual(expect.arrayContaining(['createAmbientLife', 'forestHelper']));
});

it('does not narrow shadowed Promise or retry functions', () => {
  expect(charges("export async function modelCatalogue(Promise) { const [{ borrowedNpcSpecimen }] = await Promise.all([import('./plugin/ui')]); return borrowedNpcSpecimen(); }")).not.toContain('createAmbientLife');
  expect(charges("import { retried } from '@wildshard/engine/boot/retry'; export async function modelCatalogue(retried) { const { borrowedNpcSpecimen } = await retried(() => import('./plugin/ui')); return borrowedNpcSpecimen(); }")).not.toContain('createAmbientLife');
});

it('restricts independent shell roots to the four composition entries', () => {
  const loader = "export async function modelCatalogue() { const ui = await import('./plugin/ui'); return ui.borrowedNpcSpecimen(); }";
  const shell = "import { enterGrid } from '@wildshard/engine/game/plugin/ui'; enterGrid();";
  for (const root of ['src/client/app/entry.ts', 'src/client/game/session/session.ts', 'src/client/game/mainMenu.ts', 'src/client/game/session/loadout.ts']) expect(charges(loader, '', shell, root, 'enterGrid')).not.toContain('enterGrid');
  expect(charges(loader, '', shell, 'src/game/unrelated.ts', 'enterGrid')).toContain('enterGrid');
});

it('does not turn a shell-loaded content catalogue into a second shard user', () => {
  const loader = "import { createAmbientLife, borrowedNpcSpecimen } from './plugin/ui'; export function modelCatalogue() { return borrowedNpcSpecimen(); } export function registerForestCatalogue() { return createAmbientLife; }";
  const shell = "import { registerForestCatalogue } from './game/client/model'; registerForestCatalogue();";
  expect(charges(loader, '', shell)).toEqual(expect.arrayContaining(['createAmbientLife', 'forestHelper']));
});
