// oxlint-disable-next-line import/no-nodejs-modules -- Inspect the actual title module graph under Node.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve source entries for the Node graph check.
import { resolve } from 'node:path';
import ts from '@typescript/typescript6';
import { expect, test } from 'vitest';

/** Runtime imports only: erased types and lazy tap actions do not load the title. */
function titleGraph(entries: readonly string[]): string[] {
  const options = ts.parseJsonConfigFileContent(ts.readConfigFile('tsconfig.json', file => ts.sys.readFile(file)).config, ts.sys, process.cwd()).options;
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!/\.[cm]?[jt]sx?$/u.test(file)) return;
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      if (node.moduleSpecifier === undefined || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause, bindings = clause?.namedBindings;
        if (clause?.phaseModifier === ts.SyntaxKind.TypeKeyword || (clause?.name === undefined && bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(row => row.isTypeOnly))) continue;
      } else if (node.isTypeOnly || (node.exportClause !== undefined && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(row => row.isTypeOnly))) continue;
      const name = node.moduleSpecifier.text;
      if (/\?(?:raw|url)$/u.test(name)) continue; // Vite data imports do not execute a JavaScript module.
      if (/^three(?:\/|$)/u.test(name)) { seen.add(name); continue; }
      const target = ts.resolveModuleName(name, file, options, ts.sys).resolvedModule?.resolvedFileName;
      if (target === undefined && (name.startsWith('.') || name.startsWith('@wildshard/')) && !/\.(?:css|png|jpe?g|webp|svg|hdr)(?:\?|$)/u.test(name)) throw new Error(`Unresolved title import: ${file}: ${name}`);
      if (target !== undefined && !target.includes('/node_modules/') && !target.endsWith('.d.ts')) visit(target);
    }
  };
  for (const entry of entries) visit(resolve(entry));
  return [...seen];
}

test('cold title, recovery, navigation and prefetch stay off the world graph', () => {
  const files = titleGraph(['src/client/app/entry.ts', 'src/client/engine/ui/StartTitle.ts', 'src/client/game/mainMenu.ts', 'src/client/game/grid/pageEntry.ts', 'src/client/game/travel/travel.ts']);
  expect(files.filter(file => /src\/(?:client|cook|server|shared)\/engine\/(?:app\/(?:app|runtime)\.ts|render\/|world\/|anim\/|physics\/)|src\/(?:client|cook|server|shared)\/game\/(?:looks\/|shardfile\/(?:product|runtimeProduct)\.ts)|src\/shards\/|^three(?:\/|$)/u.test(file))).toEqual([]);
});

test('standalone session bootstrap leaves grid construction behind its assembly import', () => {
  const files = titleGraph(['src/client/game/session/session.ts', 'src/client/game/shardfile/client.ts']);
  expect(files.filter(file => /src\/(?:client|cook|server|shared)\/game\/grid\/(?:session|liveSession|roadLookPlatform|roadCull|crossing)\.ts$/u.test(file))).toEqual([]);
});

test('client phase admission keeps unused feature constructors outside its static graph', () => {
  const files = titleGraph(['src/client/game/session/session.ts', 'src/client/game/shardfile/client.ts']);
  expect(files.filter(file => /src\/(?:client|cook|server|shared)\/game\/shardfile\/(?:clientCatalogue|clientMeadow|clientHeldMelee|clientSpeciesProgram|clientQuestPage|clientPopulation|clientBossFight|clientBossTelegraph|clientPlayerEnter)\.ts$/u.test(file))).toEqual([]);
});

test('selected discovery composition has no static shard or complete-list dependency',()=>{
  const files=titleGraph(['src/client/app/shardSelection.ts']);
  expect(files.filter(file=>/src\/(?:shards\/|shardList\.ts$|shards\.generated\.ts$)/u.test(file))).toEqual([]);
});

test('standalone sessions leave grid presentation and equipment behind grid-only imports', () => {
  const files = titleGraph(['src/client/game/session/session.ts']);
  expect(files.filter(file => /src\/(?:client|cook|server|shared)\/game\/grid\/(?:reveal|gridHud|budgetOverlay|budgetPoints|memoryRows|minimapBlend|enteredEquipment)\.ts$/u.test(file))).toEqual([]);
});

test('client admission and unused world features do not load presentation owners', () => {
  const files = titleGraph(['src/client/game/shardfile/clientSource.ts', 'src/client/game/session/session.ts', 'src/client/game/shardfile/client.ts']);
  expect(files.filter(file => /src\/(?:client|cook|server|shared)\/game\/(?:plugin\/ui|shardfile\/(?:sceneDressing|worldScenes|sceneMotion|weatherFields|clientCues)|models\/(?:islandLibrary|worldSceneCatalogue))\.ts$/u.test(file))).toEqual([]);
});

test('shared held construction leaves broad UI and quest presentation cold', () => {
  const files = titleGraph(['src/client/game/plugin/weaponFamily.ts', 'src/client/game/plugin/heldFirearm.ts']);
  expect(files.filter(file => /src\/(?:client|cook|server|shared)\/game\/(?:plugin\/(?:ui|bossStorm)|quest\/(?:pageComposition|reward)|loot\/CoinBurst)\.ts$/u.test(file))).toEqual([]);
});

test('selected catalogue and status bindings leave quest presentation cold', () => {
  const files = titleGraph(['src/client/game/shardfile/clientCatalogue.ts', 'src/client/game/loadout/effects.ts', 'src/client/engine/combat/effects/EffectService.ts']);
  expect(files.filter(file => /src\/(?:client|cook|server|shared)\/game\/(?:plugin\/ui|quest\/chapter)\.ts$/u.test(file))).toEqual([]);
});

test('item catalogue metadata does not import native item or projectile owners', () => {
  const files = titleGraph(['src/shared/game/loadout/itemCatalogue.ts']);
  expect(files.filter(file => /src\/(?:game\/plugin\/(?:nativeItems|simulation)|engine\/combat\/)|^three(?:\/|$)/u.test(file))).toEqual([]);
});

test('the synchronous practice room leaves async model and motion preparation cold', () => {
  const files = titleGraph(['src/client/engine/practice/TrainingArena.ts']);
  expect(files.filter(file => /src\/(?:client|cook|server|shared)\/engine\/practice\/(?:TrainingDummyAssets|DummyClips)\.ts$/u.test(file))).toEqual([]);
});


test('texture preparation does not import the GLTF parser', () => {
  const files = titleGraph(['src/client/engine/core/ktx2.ts']);
  expect(files.filter(file => /^three\/examples\/jsm\/(?:loaders\/GLTFLoader|libs\/meshopt_decoder)/u.test(file))).toEqual([]);
});

test('session and eager rig contracts leave the bounded parser and decoder cold', () => {
  const files = titleGraph(['src/client/game/session/session.ts', 'src/client/game/shardfile/client.ts', 'src/client/engine/anim/rig.ts']);
  expect(files.filter(file => /src\/(?:client|cook|server|shared)\/engine\/anim\/rigParser\.ts$|^three\/examples\/jsm\/(?:loaders\/GLTFLoader|libs\/meshopt_decoder)/u.test(file))).toEqual([]);
});

test('model byte admission leaves complete product validation off the entry graph', () => {
  const files = titleGraph(['src/client/game/shardfile/client.ts']);
  expect(files.filter(file => /src\/format\/(?:product|assetAdmission)\.ts$/u.test(file))).toEqual([]);
});
