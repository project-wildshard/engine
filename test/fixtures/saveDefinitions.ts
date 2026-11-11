// WIRE-STABILITY WR7: every persisted save definition in this engine, for saves.lock.json and the whole-document pins.
import { definedSaveKeys, SaveStore, type SaveKeyDef } from '../../src/shared/engine/saves/store';
import * as continuation from '../../src/server/host/standalone/continuation';
import * as durability from '../../src/server/game/grid/durability';
import '../../src/shared/game/saves';
import * as localSaveKeys from '../../src/shared/game/localSaveKeys';
import * as ledger from '../../src/shared/game/ledger';
import { legacyRewardSlot } from '../../src/shared/game/quest/pagePersistence';
import { legacyAdventureBond, legacyAdventureCosmetics, legacyAdventureNames } from '../../src/shared/game/quest/legacyRecords';
import * as runtimeState from '../../src/shared/game/shardfile/runtimeState';
import * as clientState from '../../src/shared/game/shardfile/clientState';
import * as buildingDoor from '../../src/shared/game/shardfile/buildingDoor';
import * as wallet from '../../src/shared/game/grid/wallet';
import * as runtimeCheckpoint from '../../src/shared/game/grid/runtimeCheckpoint';
import * as recovery from '../../src/shared/game/grid/recovery';
import '../../src/shared/engine/world/interact/flags';
import '../../src/client/host/online/voice';
import { summaryStore } from '../../src/client/game/summary';
import * as travel from '../../src/client/game/travel/travel';
import * as pageEntry from '../../src/client/game/grid/pageEntry';
import { shardRefusals } from '../../src/client/game/grid/refusal';
import * as crashResume from '../../src/client/game/session/crashResume';
import { titlePrefetchChoice } from '../../src/client/game/grid/titlePrefetchChoice';
import { gridIntents } from '../../src/client/game/grid/intent';
import '../../src/client/engine/ui/voiceSettings';
import '../../src/client/engine/input/bindings';
import '../../src/client/engine/saves/slots';
import { SessionHealth } from '../../src/client/engine/telemetry/health';

const isDefinition = (value: unknown): value is SaveKeyDef<unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
  && typeof (value as Record<string, unknown>)['key'] === 'string' && typeof (value as Record<string, unknown>)['version'] === 'number'
  && typeof (value as Record<string, unknown>)['scope'] === 'string' && typeof (value as Record<string, unknown>)['initial'] === 'function';
/** Every persisted definition: the ones defined on import, the exported ones, and the ones a factory defines. */
export function definitions(): Map<string, SaveKeyDef<unknown>> {
  const store = new SaveStore({ local: null, session: null });
  const exported = [continuation, durability, localSaveKeys, ledger, runtimeState, clientState, buildingDoor, wallet, runtimeCheckpoint, recovery, travel, pageEntry, crashResume]
    .flatMap(module => Object.values(module)).flatMap(value => Array.isArray(value) ? value as unknown[] : [value]).filter(isDefinition);
  for (const definition of exported) store.define(definition);
  summaryStore(store, () => null); shardRefusals(store); titlePrefetchChoice(store); gridIntents(store);
  new SessionHealth(store, '', () => undefined, 0, () => 'lock');
  // Families: one schema under many keys. The lock names each by its family.
  legacyRewardSlot(store, '(quest reward)'); legacyAdventureNames('(legacy names)'); legacyAdventureCosmetics('(legacy cosmetics)'); legacyAdventureBond('(legacy bond)');
  return new Map([...definedSaveKeys()].sort(([a], [b]) => a.localeCompare(b)));
}
