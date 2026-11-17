/** buildTerrain(seed, spec) and its metadata: format's law (SDK-SPLIT SP5a, Q35); the bake and the engine build one field. */
import * as field from '@wildshard/format/terrainField';

export type Vec2 = field.Vec2;
export type CabinSite = field.CabinSite;
export type PondDef = field.PondDef;
export type TerrainNoise = field.TerrainNoise;
export type TerrainField = field.TerrainField;
export type TerrainSpec = field.TerrainSpec;
export const landscapeHash: typeof field.landscapeHash = field.landscapeHash;
export const buildTerrainMetadata: typeof field.buildTerrainMetadata = field.buildTerrainMetadata;
export const buildTerrain: typeof field.buildTerrain = field.buildTerrain;
