import { NPC_FOCUS_PROGRAMS } from '../../src/shards/driftwood-isle/generators/npcFocusPrograms';
import { CASTAWAY } from '../../src/shards/driftwood-isle/generators/questStory';
import { DRIFTWOOD_GRAPH, DRIFTWOOD_ACTIONS } from '../../src/shards/driftwood-isle/generators/questGraph';
import { EXPLORER_CATALOGUE as driftwood } from '../../src/shards/driftwood-isle/generators/explorerCatalogue';
import { EXPLORER_CATALOGUE as nalati } from '../../src/shards/nalati-grasslands/generators/explorerCatalogue';
import { peoplePrograms } from '../../src/shards/nalati-grasslands/generators/peopleMotion';
import { NALATI_WEATHER_PROGRAMS, NALATI_TINT_PROGRAMS } from '../../src/shards/nalati-grasslands/generators/weatherChannels';
import { hashImmutableBytes } from '../../src/shared/host/immutable';

/** G966 changed only these two source labels. Keep the historical byte oracle
 * intact, and refuse any missing, duplicate or foreign current provenance. */
export function historicalDriftwoodCatalogue(catalogue: typeof driftwood): typeof driftwood {
  const expected = new Set(['shared/boar', 'shared/bear']), seen = new Set<string>();
  const entries = catalogue.entries.map(row => {
    if (row.kind !== 'species' || row.id === undefined || !expected.has(row.id)) return row;
    if (row.file !== 'src/client/game/models/explorerCatalogue.ts' || seen.has(row.id))
      throw new Error('Unexpected G966 catalogue provenance');
    seen.add(row.id);
    return { ...row, file: 'src/game/models/creatures.ts' };
  });
  if (seen.size !== expected.size) throw new Error('Missing G966 catalogue provenance');
  return { ...catalogue, entries };
}

/** Full original program/dialogue/interaction/catalogue wires before SDK import migration. */
export function channelQuestAuthorObservation(catalogue: typeof driftwood = driftwood) {
  return Object.entries({ focus: NPC_FOCUS_PROGRAMS, dialogue: CASTAWAY, graph: DRIFTWOOD_GRAPH, actions: DRIFTWOOD_ACTIONS,
    driftwood: historicalDriftwoodCatalogue(catalogue), nalati, people: peoplePrograms, weather: NALATI_WEATHER_PROGRAMS, tint: NALATI_TINT_PROGRAMS }).map(([name, row]) => {
      const bytes = new TextEncoder().encode(JSON.stringify(row)); return { name, bytes: bytes.length, hash: hashImmutableBytes(bytes) };
    });
}
