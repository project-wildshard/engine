// TEST-SPEED TS5 (J255): dedicated-save-safety was 27-35 s hosted.
import { type SaveWrite } from '../../src/server/host/dedicated/saves/saveStore';
import type { PlayerDoc } from '../../src/server/host/dedicated/playerDoc';

export const doc = (x = 5): PlayerDoc => ({ at: { x, y: 1, z: 0, yaw: 0 }, health: { state: { version: 1, attributes: { health: 100, maxHealth: 100 }, effectTags: [], cause: null, previousMode: 'foot' }, sinceHurt: 0 }, book: { player: 'body', flags: [], quests: [], parts: {} }, respawn: null, seats: [], store: {}, ledger: { serial: 0, rows: [] } });
export const write = (seq: number, saved: PlayerDoc, receipts: SaveWrite['receipts'] = []): SaveWrite => ({ player: 'device:a', name: 'A', shard: 'driftwood-isle', build: 'bench', saveVersion: 1, seq, reason: 'test', doc: saved, receipts });
