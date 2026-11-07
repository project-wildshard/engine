import { hashImmutableBytes } from '../../src/shared/host/immutable';
import { nalatiTitanView } from '../../src/shards/nalati-grasslands/generators/titanView';
import { nalatiEliteViews } from '../../src/shards/nalati-grasslands/generators/eliteViews';
import { fireRows, WAYMARK_FIRE, COOKFIRE, KEEPER_LAMP, SIGNAL_FIRE } from '../../src/shards/sunscar-dunes/generators/rows/fire';

/** Complete original view banks and all four authored fire profiles. */
export function viewAuthorObservation() {
  return Object.entries({ titan: nalatiTitanView(), elite: nalatiEliteViews(['qara-batyr', 'argymaq']),
    fires: [WAYMARK_FIRE, COOKFIRE, KEEPER_LAMP, SIGNAL_FIRE].map(fireRows) }).map(([name, value]) => {
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      return { name, bytes: bytes.length, hash: hashImmutableBytes(bytes) };
    });
}
