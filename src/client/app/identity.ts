// Install identity and host environments before entry; selected-entry preparation
// installs asset tables before gameplay imports. Node bakers install their own.
import { installBrowserSaveEnvironment } from '@wildshard/engine/saves/view/storage';
import { installBrowserScopeEnvironment } from '@wildshard/engine/app/view/scopeEnvironment';
import { installAppIdentity } from '@wildshard/engine/app/identity';
import { WILDSHARD_IDENTITY } from '@wildshard/engine/game/identity';

installAppIdentity(WILDSHARD_IDENTITY);
installBrowserSaveEnvironment();
installBrowserScopeEnvironment();
