import { parse, object } from 'valibot';
import { ScalarTripletSchema, ScalarLatticeSchema } from '@wildshard/format/scalarChannel';
import { GroundRowsSchema } from '@wildshard/format/terrain';
import { declaredGround, declaredGroundColour, declaredSurface, declaredMapColour } from '../../src/client/game/shard/manifest';
import { ScalarLatticeBindings } from '../../src/shared/engine/world/scalarChannel';
import { mapPalette } from '@wildshard/format/minimap';
import { readNalatiGeography } from './nalati-geography';
import { liveGeographyBlocks, liveGeographyRows } from './liveGeography';
const rows = parse(object({ground: GroundRowsSchema, pigment: ScalarTripletSchema, surface: ScalarTripletSchema,
  channels: object({mapRed: ScalarLatticeSchema, mapGreen: ScalarLatticeSchema, mapBlue: ScalarLatticeSchema})}), liveGeographyRows);
const bindings = new ScalarLatticeBindings();
export const GROUND = declaredGround(rows.ground, bindings);
export const TERRAIN = GROUND.terrain;
export const groundColor = declaredGroundColour(rows.pigment, bindings);
export const surfaceAt = declaredSurface(rows.surface, bindings);
export const NALATI_MINIMAP = { ...mapPalette(readNalatiGeography().map), ground: declaredMapColour([rows.channels.mapRed, rows.channels.mapGreen, rows.channels.mapBlue], bindings) };
bindings.prepare(liveGeographyBlocks());
