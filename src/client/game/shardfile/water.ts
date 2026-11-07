import * as v from 'valibot';
import { declaredWaterBody } from '@wildshard/engine/world/water/declared';
import type { WaterBody } from '@wildshard/engine/world/water/body';

import { WaterSchema } from '@wildshard/format/water';

/** Validate untrusted declarations and return fresh motor-compatible bodies for one level instance. */
export function shardfileWater(input: unknown): WaterBody[] { return v.parse(WaterSchema, input).map(declaredWaterBody); }
