// The title screen's layout proof (test/title-layout.test.ts): the real main menu, WHAT'S NEW box and build pill, with the
// app's own stylesheets, over no game. ?dev=0 is a player's title, ?online=0 a build without a world (no Check connection).
import '../../src/client/engine/ui/styles/base.css';
import '../../src/client/engine/ui/styles/menu.css';
import '../../src/client/engine/ui/styles/update.css';
import { installBrowserScopeEnvironment } from '../../src/client/engine/app/view/scopeEnvironment';
import { installShards } from '../../src/client/game/shard/list';
import { installTitleManifests } from '../../src/client/game/shard/titleList';
import { buildTitleMenu } from '../../src/client/game/mainMenu';
import '../../src/client/engine/ui/Update';

installBrowserScopeEnvironment();
installShards([]);
installTitleManifests([]);
const developer = new URLSearchParams(location.search).get('dev') !== '0';
const menu = buildTitleMenu({ cards: [], active: null, onEnter: () => undefined, onExplore: () => undefined, onSettings: () => undefined, onGrid: () => undefined,
  mode: () => ({ developer, devserver: false }) });
document.getElementById('hud')?.append(menu.root);
menu.start();
(window as unknown as { titleReady: boolean }).titleReady = true;
