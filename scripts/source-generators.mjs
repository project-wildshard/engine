// G798 / GS2: the app-wide generated source tables (the GS1 inventory in
// project/archive/2026-10-27-generators-spike.md), one registry row each. A row names its outputs, the input
// globs that feed them and how they are made: `generate` returns every output's text from plain producers (no Vite
// plugin, no virtual module, no shard build, G799); `run` drives a producer that writes its own outputs and has its own
// --check. `pnpm gen:source` (scripts/gen-source.mjs) runs them; the pre-commit hook and CI select them by input.
// GS3: each row owns its committed outputs, checked by the exact registry census. The artifact publisher owns
// its bounded boot-publication facts; these plain formatters never build native
// assets, read discovery modules or depend on ignored intermediate tables.
import { matchesGlob } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @typedef {{ readonly id: string; readonly outputs: readonly string[]; readonly inputs: readonly string[]; readonly committed: boolean;
 *   readonly generate?: (root: string) => Promise<Readonly<Record<string, string>>>;
 *   readonly run?: (root: string, check: boolean) => void; readonly note?: string }} SourceGenerator */

/** @param {string} id @param {string} script @param {string} input @param {string} output @param {string} source @returns {SourceGenerator} */
const starter = (id, script, input, output, source) => ({
  id, outputs: [output], inputs: [input, script], committed: true,
  generate: async root => ({ [output]: (await import(pathToFileURL(`${root}/${script}`).href))[source]() }),
});

const MANIFEST_INPUTS = ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.mjs', 'src/**/*.js', 'src/**/package.json', 'src/shards/*/manifest.json', 'src/shards/*/outputs.json', 'src/shards/*/{data,boot}/*.json', 'tsconfig*.json', 'scripts/gen-shards.mjs', 'scripts/shard-outputs.mjs', 'scripts/authored-manifest.mjs', 'scripts/generated-source.mjs', 'lint/generated-source-debt.json', 'lint/generated-import-debt.json', 'scripts/manifest-static-imports.mjs', 'scripts/manifest-art-inputs.json'];

/** @type {readonly SourceGenerator[]} */
export const SOURCE_GENERATORS = [
  {
    id: 'title-asset-urls', outputs: ['scripts/title-assets.generated.json', 'index.html'], committed: true,
    inputs: ['public/assets/title/*', 'scripts/title-assets.mjs', 'index.html'],
    generate: async root => (await import(pathToFileURL(`${root}/scripts/title-assets.mjs`).href)).titleAssetTables(root),
  },
  starter('starter-arm-clips', 'scripts/gen-starter-arm-clips.mjs', 'src/client/game/systems/viewmodel/armAliases.json', 'src/client/game/systems/viewmodel/clips.generated.ts', 'starterArmClipsTableSource'),
  starter('starter-weapons', 'scripts/gen-starter-weapons.mjs', 'src/shared/game/weapons/starterBow.json', 'src/shared/game/weapons/starter.generated.ts', 'starterWeaponsTableSource'),
  starter('starter-bag', 'scripts/gen-starter-bag.mjs', 'src/shared/game/bag/starterItems.json', 'src/shared/game/bag/starter.generated.ts', 'starterBagTableSource'),
  starter('starter-effects', 'scripts/gen-starter-effects.mjs', 'src/shared/game/systems/effects/starterRows.json', 'src/client/game/systems/effects/starter.generated.ts', 'starterEffectsTableSource'),
  {
    id: 'shard-list',
    outputs: ['src/client/app/shards.generated.ts'],
    inputs: ['src/shards/*/manifest.ts', 'src/shards/*/manifest.json', 'src/shards/*/outputs.json', 'src/shared/game/grid/singleplayer.json', 'scripts/gen-shards.mjs', 'scripts/shard-outputs.mjs', 'scripts/authored-manifest.mjs', 'scripts/generated-source.mjs', 'lint/generated-source-debt.json', 'lint/generated-import-debt.json'],
    committed: true,
    note: 'literal composition imports derive from authored declarations; no discovery contents or products are read',
    generate: async root => ({ 'src/client/app/shards.generated.ts': (await import(pathToFileURL(`${root}/scripts/gen-shards.mjs`).href)).shardSource(root) }),
  },
  {
    id: 'manifest-closure',
    outputs: ['src/server/game/shard/manifest-closure.generated.json'],
    inputs: MANIFEST_INPUTS,
    committed: true,
    note: 'walks authored runtime edges and declared program-art inputs without any discovery output or product',
    generate: async root => ({ 'src/server/game/shard/manifest-closure.generated.json': `${JSON.stringify((await import(pathToFileURL(`${root}/scripts/gen-shards.mjs`).href)).manifestClosure(root), null, 2)}\n` }),
  },
  {
    id: 'boot-audio',
    outputs: ['src/client/game/boot/audio.generated.ts'],
    inputs: ['public/assets/music/*/music.json', 'public/assets/sfx/*/sfx.json', 'scripts/app-build/gen.ts'],
    committed: true,
    generate: async root => ({ 'src/client/game/boot/audio.generated.ts': (await import(pathToFileURL(`${root}/scripts/app-build/gen.ts`).href)).audioTableSource(root) }),
  },
  {
    id: 'boot-tables',
    outputs: ['src/client/game/boot/bytes.generated.ts', 'src/client/game/boot/versions.generated.ts'],
    inputs: ['scripts/boot-publication.generated.json', 'scripts/boot-publication.mjs'],
    committed: true,
    note: 'plain tables of the successful artifact publisher\'s committed byte and content-version facts',
    generate: async root => {
      const sources = (await import(pathToFileURL(`${root}/scripts/boot-publication.mjs`).href)).bootPublicationTableSources(root);
      return { 'src/client/game/boot/bytes.generated.ts': sources['src/client/game/boot/bytes.generated.ts'], 'src/client/game/boot/versions.generated.ts': sources['src/client/game/boot/versions.generated.ts'] };
    },
  },
  {
    id: 'packs',
    outputs: ['src/client/game/boot/packs.generated.ts'],
    inputs: ['scripts/boot-publication.generated.json', 'scripts/boot-publication.mjs'],
    committed: true,
    note: 'plain source formatting of the complete published part inventory; no pack/blob/native work during source generation',
    generate: async root => ({ 'src/client/game/boot/packs.generated.ts': (await import(pathToFileURL(`${root}/scripts/boot-publication.mjs`).href)).bootPublicationTableSources(root)['src/client/game/boot/packs.generated.ts'] }),
  },
  {
    id: 'ktx2',
    outputs: ['src/client/engine/boot/ktx2.generated.ts'],
    inputs: ['scripts/ktx2-engine-map.json', 'scripts/ktx2-tables.mjs'],
    committed: true,
    note: 'the encoder publishes its activated common mappings beside assets; the plain table needs no native encoder',
    generate: async root => ({ 'src/client/engine/boot/ktx2.generated.ts': (await import(pathToFileURL(`${root}/scripts/ktx2-tables.mjs`).href)).engineKtx2TableSource(root) }),
  },
  {
    id: 'port-shares',
    outputs: ['src/server/game/shard/portShares.generated.ts'],
    inputs: ['scripts/source-generators.mjs'],
    committed: true,
    note: 'no producer or consumer measures it yet: the reviewed map stays empty (absent = unavailable, never zero custom)',
    generate: () => Promise.resolve({ 'src/server/game/shard/portShares.generated.ts': '// Generated by gen:source (scripts/source-generators.mjs) from reviewed measurements; absent means unclosed/unavailable, never zero custom.\nexport const PORT_SHARES: Readonly<Record<string, number>> = {};\n' }),
  },
];

/** The rows any of `paths` (repo-relative) touches: a changed input selects every row whose outputs it can change, and a
 *  changed output selects its own row (a hand edit is regenerated or refused).
 * @param {readonly string[]} paths @returns {SourceGenerator[]} */
export function selectSourceGenerators(paths) {
  if (paths.some(path => ['scripts/source-generators.mjs', 'scripts/gen-source.mjs', 'scripts/committed-source-tables.mjs', 'scripts/git-source-view.mjs'].includes(path))) return [...SOURCE_GENERATORS];
  return SOURCE_GENERATORS.filter(row => paths.some(path => row.outputs.includes(path) || row.inputs.some(glob => matchesGlob(path, glob))));
}
