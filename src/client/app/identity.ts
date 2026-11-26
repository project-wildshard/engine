// Install identity and host environments before entry; selected-entry preparation
// installs asset tables before gameplay imports. Node bakers install their own.
import { installBrowserSaveEnvironment } from '@wildshard/engine/saves/view/storage';
import { installBrowserScopeEnvironment } from '@wildshard/engine/app/view/scopeEnvironment';
import { installAppIdentity } from '@wildshard/engine/app/identity';
import { WILDSHARD_IDENTITY } from '@wildshard/engine/game/identity';
import { addContentCacheOrigin } from '@wildshard/engine/boot/contentBase';
import { COOKED_ORIGIN } from '@wildshard/engine/game/shardfile/cookedPackPaths';
import { startTaskStamp } from '@wildshard/engine/core/taskStamp';

installAppIdentity(WILDSHARD_IDENTITY);
installBrowserSaveEnvironment();
installBrowserScopeEnvironment();
if (typeof document !== 'undefined' && document.getElementById('ws-zone-table') !== null) addContentCacheOrigin(COOKED_ORIGIN);
// DF8 (mini-driftwood13m): `debug.taskStamp` wraps every later timer, listener and observer (the first page script)
startTaskStamp();
