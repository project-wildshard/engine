// The in-game Settings proof (test/settings-tabs-browser.proof.mjs, J245): the real GameMenu and every Settings row, with the
// app's own stylesheets, over no game. The proof drives it through `window.__settings`.
import '../../src/client/app/identity'; // the game's identity and storage, first, as the page entry does
import '../../src/client/engine/ui/styles/base.css';
import '../../src/client/engine/ui/styles/gmenu.css';
import '../../src/client/engine/ui/styles/debug.css';
import { installAssetTables } from '../../src/shared/engine/boot/tables';
import { Scope } from '../../src/shared/engine/app/scope';
import { withOwner } from '../../src/shared/engine/app/ownership';
import { legacyDouble } from '../../src/test/engine/FakeGame';
import { bindFlatTerrain } from '../../src/test/engine/terrain';
import { GameMenu } from '../../src/client/engine/ui/Menu';
import type { FullMap } from '../../src/client/engine/ui/Map';
import { getMusicStyle, getNumber, getSetting, savedSetting } from '../../src/client/engine/ui/Settings';
import { gfxPrefs } from '../../src/client/engine/core/tier';
import { graphicsMode } from '../../src/client/engine/core/graphicsMode';
import { isDev } from '../../src/client/engine/core/devMode';
import { registerGraphicsControl } from '../../src/client/engine/ui/graphicsControls';
import { openBootSettings } from '../../src/client/engine/ui/BootSettings';
import { reviewUnlocked } from '../../src/client/engine/ui/review';

installAssetTables({ bytes: {}, versions: {}, music: {}, sfx: {}, packs: {} });
const owner = new Scope('settings-proof');
owner.onDispose(bindFlatTerrain());
const map = legacyDouble<FullMap>({ mount: () => undefined, setZoom: () => undefined, fit: () => undefined, show: () => undefined, hide: () => undefined, hasRoom: false, zoom: 1, quest: null });
const held = { weapons: new Set<string>(), melee: false, tracers: false, huntersEye: false };
const menu = withOwner(owner, () => new GameMenu({ levelName: 'Driftwood Isle', fullMap: map, settings: () => held }));
// the game's own section (its shard save cards, G83), as savesSettings.ts adds it
const cards = document.createElement('div'); cards.className = 'ws-gmenu-row'; cards.dataset['proof'] = 'saveCards'; cards.textContent = 'Shard save cards';
menu.addSettingsSection('saves.game', [cards], { first: true });
// SR13: the composer System ▸ Feedback opens (the game's Feedback.mountTab draws into the slot it's handed)
let composed = 0;
menu.onFeedbackTab = (slot) => { composed++; const c = document.createElement('div'); c.dataset['proof'] = 'composer'; c.textContent = 'Composer'; slot.replaceChildren(c); };
Object.assign(window, { __settings: { menu, held, getSetting, getNumber, savedSetting, getMusicStyle, gfxPrefs, graphicsMode, isDev, registerGraphicsControl, openBootSettings, reviewUnlocked, composed: () => composed } });
(window as unknown as { settingsReady: boolean }).settingsReady = true;
