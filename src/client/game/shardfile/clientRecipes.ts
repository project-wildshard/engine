import { SphereGeometry, Float32BufferAttribute, Uint16BufferAttribute, MeshStandardMaterial, MeshLambertMaterial, type Material } from 'three';
import { NO_FUR } from '@wildshard/engine/entities/species/rigs';
import type { SpeciesLook } from '@wildshard/engine/entities/species/look';
import type { ShardRows } from '@wildshard/format/rows';
import { SKIN_LOOK_RECIPE } from '@wildshard/format/skins';
import { skinSpeciesLook, type ClientSkin } from './clientSkins';

/** A trusted catalogue recipe receives validated JSON parameters and the chosen declared species. */
export type ShardViewRecipe = (row: ShardRows['looks'][number], species: ShardRows['species'][number]) => SpeciesLook;

function number(row: ShardRows['looks'][number], key: string, fallback: number, min: number, max: number): number {
  const value = row.parameters[key] ?? fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid sphere view parameter ${key}`);
  return value;
}
function sphere(row: ShardRows['looks'][number], species: ShardRows['species'][number]): SpeciesLook {
  if (row.animation.recipe !== 'engine.scale-wave') throw new Error('Unknown sphere animation recipe');
  const radius = number(row, 'radius', species.dims.bodyY, 0.001, 20), width = number(row, 'widthSegments', 10, 3, 32), height = number(row, 'heightSegments', 6, 2, 16);
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error('Sphere segments must be integer');
  const tint = row.parameters['colour'] ?? [0.45, 0.45, 0.45];
  if (!Array.isArray(tint) || tint.length !== 3 || tint.some((value) => value < 0 || value > 1)) throw new Error('Invalid sphere colour');
  const animation = row.animation.parameters, axis = animation['axis'] ?? 'y';
  if (axis !== 'x' && axis !== 'y' && axis !== 'z') throw new Error('Invalid scale-wave axis');
  const scalar = (key: string, fallback: number, min: number, max: number): number => {
    const value = animation[key] ?? fallback; if (typeof value !== 'number' || value < min || value > max) throw new Error('Invalid scale-wave value'); return value;
  };
  const frequency = scalar('frequency', 4, 0, 60), amplitude = scalar('amplitude', 0.08, 0, 1), rest = scalar('rest', 1, 0.001, 10), dead = scalar('dead', 0.4, 0.001, 10);
  return { id: row.id, species: species.id, kind: species.kind, rig: 'custom', fur: NO_FUR,
    rigContract: { skeleton: 'platform.sphere', sockets: ['body', 'head'], clips: ['idle', 'walk', 'attack', 'hit', 'die'] },
    build: () => {
      const geometry = new SphereGeometry(radius, width, height); geometry.translate(0, species.dims.bodyY, 0);
      const count = geometry.getAttribute('position').count;
      geometry.setAttribute('color', new Float32BufferAttribute(Float32Array.from({ length: count * 3 }, (_value, i) => tint[i % 3] ?? 1), 3));
      geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(count * 4), 4));
      const weights = new Float32Array(count * 4); for (let i = 0; i < count; i++) weights[i * 4] = 1;
      geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
      return { bones: [{ name: 'body', parent: null, pos: [0, species.dims.bodyY, 0] }, { name: 'head', parent: 'body', pos: [0, species.dims.bodyY + radius / 2, 0] }], furParts: [], hardParts: [geometry], eyeParts: [], dims: { ...species.dims, feet: species.dims.feet.map(([x, z]) => [x, z]) } };
    },
    animate: ({ bones, t, alive }) => { const body = bones['body']; if (body !== undefined) { body.scale.set(1, 1, 1); body.scale[axis] = alive ? rest + Math.sin(t * frequency) * amplitude : dead; } },
  };
}
/** Resolve every recipe before boot; injected kit recipes, platform primitives and exported skins (`skins`, keyed by look id) remain ordinary engine views. */
export function clientSpeciesLooks(rows: ShardRows, recipes: ReadonlyMap<string, ShardViewRecipe>, materials: ReadonlyMap<string, Material>, skins: ReadonlyMap<string, ClientSkin> = new Map()): readonly SpeciesLook[] {
  return rows.looks.map((row) => {
    const species = rows.species.find((entry) => entry.id === row.species); if (species === undefined) throw new Error('Missing view species');
    if (row.recipe === SKIN_LOOK_RECIPE) { const skin = skins.get(row.id); if (skin === undefined) throw new Error(`Unloaded skin look ${row.id}`); if (row.material !== null) throw new Error('A skin look draws with its binding material'); return skinSpeciesLook(row, species, skin); }
    const recipe = row.recipe === 'engine.sphere' ? sphere : recipes.get(row.recipe); if (recipe === undefined) throw new Error(`Unknown creature view recipe ${row.recipe}`);
    const look = recipe(row, species);
    if (row.material === null) return { ...look, id: row.id, species: species.id, kind: species.kind };
    const material = materials.get(row.material); if (!(material instanceof MeshStandardMaterial) && !(material instanceof MeshLambertMaterial)) throw new Error('Creature surface requires a lit platform material');
    return { ...look, id: row.id, species: species.id, kind: species.kind, material: () => material };
  });
}
