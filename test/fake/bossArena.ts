import { BossArenaRoom } from '../../src/client/game/boss/arenaRoomView';
import room from '../../src/shards/nalati-grasslands/data/bossArenaRoom.json' with { type: 'json' };
import view from '../../src/shards/nalati-grasslands/data/kurganView.json' with { type: 'json' };
import { SHAPES } from '../fixtures/nalatiShapes';

export function bossArena(): BossArenaRoom {
 return new BossArenaRoom({ ...room, view }, new Map([...view.scene.nodes, ...view.static.nodes].flatMap(row => 'geometry' in row ? [[row.geometry, SHAPES.handle(row.geometry).copy()]] as const : [])));
}
