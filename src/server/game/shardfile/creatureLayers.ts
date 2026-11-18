import { parse, strictObject, pipe, number, finite, minValue, maxValue, type InferOutput, type GenericSchema } from 'valibot';
import { CreatureBodySchema, CreatureTemperamentSchema, CreatureSensesSchema, CreatureAbilitySchema, CreaturePresentationSchema,
  type CreatureBody, type CreatureTemperament, type CreatureSenses, type CreatureAbility, type CreaturePresentation } from '@wildshard/format/creatureLayers';
import type { SkeletonContract } from '@wildshard/format/creatureSkeletons';
import { bodyContract } from '../../../shared/game/shardfile/creatureContract';
import { CreaturesSchema, type ShardCreatures } from '@wildshard/format/creatures';
import { HuntTuningSchema } from '@wildshard/format/speciesPrograms';
import type { ShardRows, StrikeRows } from '@wildshard/format/rows';

type BrainRow = ShardCreatures['brains'][number];
type HuntNumbers = InferOutput<typeof HuntTuningSchema>;
interface HuntMotion { walkSpeed: number; chargeSpeed: number; chargeWindup: number; ringRadius: number; trampleRadius: number }
const HuntMotionSchema: GenericSchema<HuntMotion> = strictObject({ walkSpeed: pipe(number(), finite(), minValue(0), maxValue(15)),
  chargeSpeed: pipe(number(), finite(), minValue(0), maxValue(15)), chargeWindup: pipe(number(), finite(), minValue(0), maxValue(3600)),
  ringRadius: pipe(number(), finite(), minValue(0), maxValue(500)), trampleRadius: pipe(number(), finite(), minValue(0), maxValue(500)) });
/** The existing policy declaration owns its parameters; hunting retains its complete numeric contract. */
export type ResolvedCreatureBrain = { readonly kind: 'none' }
  | { readonly kind: 'hunt'; readonly tuning: HuntNumbers; readonly motion?: HuntMotion }
  | { readonly kind: 'declared'; readonly declaration: BrainRow; readonly referenced: boolean };
/** Preflighted semantic layers, before any body, callback, view or random stream is created. */
export interface ResolvedCreatureLayers {
  readonly species: string;
  readonly body?: CreatureBody;
  readonly skeleton?: SkeletonContract;
  readonly temperament: CreatureTemperament;
  readonly brain: ResolvedCreatureBrain;
  readonly senses?: CreatureSenses;
  readonly abilities: readonly { readonly ability: CreatureAbility; readonly strike: StrikeRows }[];
  readonly presentation?: CreaturePresentation;
}

function brainRow(input: unknown, name: string): BrainRow {
  try {
    const [row] = parse(CreaturesSchema, { brains: [input], groups: [], spawns: [] }).brains;
    if (row === undefined) throw new Error('Missing brain declaration');
    return row;
  } catch (error) {
    throw new Error(`brain ${name} tuning: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

function resolveBrain(temperament: CreatureTemperament, senses: CreatureSenses | undefined, declarations: ReadonlyMap<string, BrainRow>, id: () => string): ResolvedCreatureBrain {
  const name = temperament.brain;
  if (name === 'none') {
    if (temperament.tuning !== undefined) throw new Error('brain none has no tuning');
    return { kind: 'none' };
  }
  const declared = declarations.get(name);
  if (declared !== undefined) {
    if (temperament.tuning !== undefined) throw new Error(`brain reference ${name} keeps its declared tuning: name an engine brain to author new parameters`);
    return { kind: 'declared', declaration: brainRow(declared, name), referenced: true };
  }
  if (name === 'hunt') {
    const { motion, ...numbers }: Record<string, unknown> = { ...temperament.tuning };
    return { kind: 'hunt', tuning: parse(HuntTuningSchema, numbers), ...(motion === undefined ? {} : { motion: parse(HuntMotionSchema, motion) }) };
  }
  const parameters = temperament.tuning;
  if (parameters === undefined) throw new Error(`brain ${name} has no tuning`);
  // The defining brain parser validates its own parameters. Layer-owned perception/home fields win for pursuit.
  const input = { ...parameters, id: id(), kind: name,
    ...(name === 'pursue' ? { leashRadius: temperament.leash, returnSpeed: temperament.home.speed, stopDistance: temperament.home.stop,
      ...(senses === undefined ? {} : { awareRadius: senses.notice }) } : {}) };
  if (name === 'pursue' && temperament.territorial !== undefined) {
    input.leashRadius = Math.min(temperament.leash, temperament.territorial);
    if (typeof input.awareRadius === 'number') input.awareRadius = Math.min(input.awareRadius, input.leashRadius);
  }
  return { kind: 'declared', declaration: brainRow(input, name), referenced: false };
}

/** Kind is a label: only explicit layers and named policy declarations select mechanics. */
export function resolveCreatureLayers(rows: ShardRows, brains: readonly BrainRow[] = []): ReadonlyMap<string, ResolvedCreatureLayers> {
  const declarations = new Map(brains.map(row => [row.id, row]));
  if (declarations.size !== brains.length) throw new Error('Duplicate creature brain declaration');
  const strikes = new Map(rows.strikes.map(row => [row.id, row])), looks = new Map(rows.looks.map(row => [row.id, row]));
  const used = new Set(declarations.keys()), result = new Map<string, ResolvedCreatureLayers>();
  for (const [index, row] of rows.species.entries()) {
    if (row.temperament === undefined) {
      if (row.body !== undefined || row.senses !== undefined || row.abilities !== undefined || row.presentation !== undefined || row.type !== undefined) {
        throw new Error(`species \`${row.id}\` has no temperament`);
      }
      // Older flat declarations already name their policies separately. They remain until the M8 source moves.
      continue;
    }
    try {
      const temperament = parse(CreatureTemperamentSchema, row.temperament);
      const body = row.body === undefined ? undefined : parse(CreatureBodySchema, row.body);
      const look = body === undefined ? undefined : looks.get(body.look);
      if (body !== undefined && (look === undefined || look.species !== row.id)) throw new Error(`unknown body look ${body.look} for this species`);
      const skeleton = body === undefined ? undefined : bodyContract(body);
      const senses = row.senses === undefined ? undefined : parse(CreatureSensesSchema, row.senses);
      const presentation = row.presentation === undefined ? undefined : parse(CreaturePresentationSchema, row.presentation);
      const abilities = (row.abilities ?? []).map(input => {
        const ability = parse(CreatureAbilitySchema, input), strike = strikes.get(ability.use);
        if (strike === undefined) throw new Error(`unknown ability strike ${ability.use}`);
        return { ability, strike };
      });
      const brain = resolveBrain(temperament, senses, declarations, () => {
        let id = `layers.${index}`;
        while (used.has(id)) id += 'x';
        used.add(id); return id;
      });
      result.set(row.id, { species: row.id, temperament, brain, abilities,
        ...(body === undefined ? {} : { body }), ...(skeleton === undefined ? {} : { skeleton }),
        ...(senses === undefined ? {} : { senses }), ...(presentation === undefined ? {} : { presentation }) });
    } catch (error) {
      throw new Error(`species \`${row.id}\`: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  return result;
}

/** Bind layer declarations to the existing policy installers without mutating admitted rows. */
export function prepareCreaturePolicies(rows: ShardRows, creatures: ShardCreatures): ShardCreatures {
  const layers = resolveCreatureLayers(rows, creatures.brains);
  const brains = [...creatures.brains], groups = new Set(creatures.groups.map(row => row.id));
  for (const layer of layers.values()) {
    if (layer.brain.kind === 'declared' && !layer.brain.referenced) {
      if (groups.has(layer.brain.declaration.id)) throw new Error(`species \`${layer.species}\`: brain id collides with a group`);
      brains.push(layer.brain.declaration);
    }
  }
  const spawns = creatures.spawns.map(spawn => {
    const layer = layers.get(spawn.species);
    if (layer === undefined) return spawn;
    // No layer controller competes with an explicit per-spawn policy (or a deliberately idle body).
    if (layer.brain.kind === 'none') return spawn;
    if (spawn.brain !== null && groups.has(spawn.brain)) {
      throw new Error(`species \`${spawn.species}\`: group and temperament both own the brain`);
    }
    const brain = layer.brain.kind === 'declared' ? layer.brain.declaration.id : null;
    if (spawn.brain !== null && spawn.brain !== brain) throw new Error(`species \`${spawn.species}\`: spawn and temperament name different brains`);
    return { ...spawn, brain };
  });
  return { ...creatures, brains, spawns };
}
