import { originalSpeciesJson } from './nalati-original-species';
import { app } from '../../src/client/engine/app/runtime';
import { ActorProjectionV2 } from '../../src/server/game/population/actorProjectionV2';
import { actorProjection } from '../../src/shards/nalati-grasslands/generators/actorProjection';
import { object, parse } from 'valibot';
import { CreatureGuestSchema } from '@wildshard/format/speciesBookRows';

const generated=parse(object({presentation:object({guest:CreatureGuestSchema})}),originalSpeciesJson('species.json'));
export const projection=new ActorProjectionV2('balbal',actorProjection(parse(CreatureGuestSchema,generated.presentation.guest)),app);
export const BALBAL_SPECIES=projection.binding;
export function program():ReturnType<ActorProjectionV2['program']>{return projection.program();}
