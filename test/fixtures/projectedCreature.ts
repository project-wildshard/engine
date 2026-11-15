import { app } from '../../src/client/engine/app/runtime';
import { parse } from 'valibot';
import { CreatureGuestSchema } from '@wildshard/format/speciesBookRows';
import { ReturnProgram } from '../../src/shared/game/population/returnProgram';
import { strikeFromData } from '../../src/shared/engine/ai/strikeRows';
import rows from './originalBalbalRows.json' with { type: 'json' };

const generated=parse(CreatureGuestSchema,rows);
let strike: ReturnType<typeof strikeFromData>|undefined;
let projected: ReturnProgram|undefined;
/** Public fixture rows preserve the original callback ordering without a shard import. */
export function program():ReturnProgram {
  strike??=strikeFromData(generated.strike);
  return projected??=ReturnProgram.page(generated.program,app.levelScope??undefined);
}
