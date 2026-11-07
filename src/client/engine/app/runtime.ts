import { setSpeciesResolver } from '../../../shared/engine/entities/species/registry';
import { seatPageApp } from '../../../shared/engine/app/pageSeat';
import { bindTelemetry } from '../telemetry/runtime';
import { bindAudioRandom } from '../audio/util';
import { App } from './app';

/** The page app; legacy active-service entry points delegate here during the migration. */
export const app: App = new App();
seatPageApp(app);
bindTelemetry(app);
bindAudioRandom(() => app.rng.stream('audio').next());

/** One gameplay draw from the seeded `gameplay` stream (01 §2): aim spread and other rolls that change a hit. */
export function gameplayRandom(): number { return app.rng.stream('gameplay').next(); }

setSpeciesResolver((kind) => app.species.get(kind));
