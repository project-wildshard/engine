import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { assembleOutputShardfile, parseOutputIndex } from '@wildshard/format/outputIndex';
import { entryFileSteps } from '@wildshard/format/tierSelection';
import { playLibrarySteps } from '@wildshard/format/admissionControl';
import { parseWorldScenes } from '@wildshard/format/worldScenes';
import { parseWorldSceneModels } from '@wildshard/format/worldSceneModels';
import { parseClientPlan } from '@wildshard/format/clientPlan';
import { buildValidationReceipts } from './validationReceipts.mjs';
import type { CookedEntryFacts } from '../../shared/game/shardfile/outputDescriptor.ts';

/** Run the runtime's selection against exact verified wire inputs at publication. */
export function cookedEntryExclusions(raw: unknown, product: string): CookedEntryFacts {
  const index = parseOutputIndex(raw), sections = new Map<string, unknown>();
  for (const section of index.sections) {
    const bytes = readFileSync(join(product, section.path));
    if (bytes.length !== section.bytes || createHash('sha256').update(bytes).digest('hex') !== section.hash) {
      throw new Error(`Cooked section hash or size differs: ${section.path}`);
    }
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    sections.set(section.name, value);
  }
  const source = assembleOutputShardfile(index, sections);
  const collect = (steps: Generator<void, ReadonlySet<string>>): number[] => {
    let step = steps.next();
    while (!step.done) step = steps.next();
    const excluded = step.value;
    return index.files.flatMap((file, at) => excluded.has(file.hash) ? [at] : []);
  };
  const descriptor = { index, sections };
  const scenes = sections.get('world/scenes');
  const admittedScenes = scenes === undefined ? undefined : parseWorldScenes(scenes);
  const sceneIsSchemaOutput = admittedScenes !== undefined && isDeepStrictEqual(scenes, admittedScenes);
  const plan = sections.get('client/plan');
  const planIsSchemaOutput = plan !== undefined && isDeepStrictEqual(plan, parseClientPlan(plan));
  let sceneCatalogue: string | undefined;
  if (admittedScenes?.catalogue !== undefined) {
    const file = index.files.find(row => row.name === admittedScenes.catalogue);
    if (file?.kind === 'json' && file.jsonSchema?.$comment === '@wildshard/format/worldSceneModels#WorldSceneModelsSchema') {
      const bytes = readFileSync(join(product, file.path));
      if (bytes.length !== file.compressed || createHash('sha256').update(bytes).digest('hex') !== file.hash) {
        throw new Error(`Cooked scene catalogue hash or size differs: ${file.path}`);
      }
      const value: unknown = JSON.parse(bytes.toString('utf8'));
      if (isDeepStrictEqual(value, parseWorldSceneModels(value))) sceneCatalogue = file.name;
    }
  }
  return { phone: collect(entryFileSteps(source, 'phone', descriptor)), desktop: collect(entryFileSteps(source, 'desktop', descriptor)),
    play: collect(playLibrarySteps(source, descriptor)), ...(sceneIsSchemaOutput ? { sceneIsSchemaOutput: true } : {}),
    ...(planIsSchemaOutput ? { planIsSchemaOutput: true } : {}), ...(sceneCatalogue === undefined ? {} : { sceneCatalogue }) };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const revision = process.argv[2];
  if (revision === undefined) throw new Error('Cooked validation verdicts require a validator revision');
  process.stdout.write(JSON.stringify(buildValidationReceipts(revision, 'out', cookedEntryExclusions)));
}
