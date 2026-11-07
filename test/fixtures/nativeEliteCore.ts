import {admissionNative} from './nalati-return-modules';
import { EliteCore, memoryElitePersistence, type EliteCoreScript } from '../../src/shared/game/eliteSystem';
import type { AnimalSim } from '../../src/shared/engine/entities/AnimalSim';
import type { SimHost } from '../../src/server/engine/sim';


export function nativeEliteCore(host: SimHost, phase = 'day', storm = false): EliteCore<EliteCoreScript<AnimalSim>> {
  const program = admissionNative(host), rules = { always: 0, storm: 1, night: 2, dusk: 3 };
  return new EliteCore({ players: host.players, condition: rule => program.project('eliteRule', {
    rule: rules[rule], phase: phase === 'night' ? 2 : phase === 'dusk' ? 1 : 0, storm: Number(storm),
  })['accept'] === 1 }, {}, host.level.id, memoryElitePersistence());
}
