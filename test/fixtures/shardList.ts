// The shard list a compiled page no longer holds: a test that walks every manifest installs them here, as Node tools do.
import { installShards } from '@wildshard/engine/game/shard/list';
import { game } from '@wildshard/engine/game/shard/registry';
import { SHARDS } from './shardCatalogue';

installShards(SHARDS);
// The running shard resolves now, as it did when the registry built it at import.
void game.shard;
