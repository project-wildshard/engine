import {checkpointCertificate} from './checkpointWitness';
import type { ChatReport } from '@wildshard/engine/net/chat';
import { migrate } from './saves/migrate';
import { openPg } from './saves/pgDatabase';
import { healSave, lastCell, placeOf, readSave, recoveryReceipts, SaveQuarantinedError, within, writeSave, type SaveWrite } from './saves/saveStore';
import { SaveWriteQueue } from './saves/writeQueue';
import { claimName, CLAIM_MS } from './saves/names';
import { claimSaves } from './saves/claim';
import { ReportWriteQueue, type ReportWrite } from './saves/reportQueue';
import type { Database } from './saves/database';
import type { PlayerSaves, SavedPlayer } from './world';
import { admitDoc } from './playerDoc';
import { PersistenceFeed } from './saves/persistenceStatus';

const WRITE_REPORT = 'insert into chat_report (reporter, speaker, name, channel, typed, shown, shard, tick, delivery_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (delivery_id) do nothing';

async function writeReport(db: Database, { id, report, shard }: ReportWrite): Promise<void> {
  await db.query(WRITE_REPORT, [report.reporter, report.speaker, report.name, report.channel, report.typed, report.shown, shard, report.tick, id]);
}
/**
 * MP2.4: one device's claims run one after another, each waiting for the last to finish in the database even when the door stopped
 * waiting for it, so a claim that timed out can never change the reservation under a later one.
 */
function namesOver(db: Database): (device: string, name: string) => Promise<string> {
  const running = new Map<string, Promise<unknown>>();
  return (device, name) => {
    const work = (running.get(device) ?? Promise.resolve()).catch(() => undefined).then(() => claimName(db, device, name));
    running.set(device, work);
    void work.catch(() => undefined).finally(() => { if (running.get(device) === work) running.delete(device); });
    return within(CLAIM_MS, () => work);
  };
}
/** The world's saves over a database, in one save epoch. A read waits for a write on its way, so a quick rejoin never loads the save before last. */
export function playerSavesOver(db: Database, epoch: number, log: (line: Record<string, unknown>) => void, contract?: (issue: string) => void): PlayerSaves & { readonly queue: SaveWriteQueue; readonly reports: ReportWriteQueue } {
  const persistence = new PersistenceFeed();
  const queue = new SaveWriteQueue({ write: async write => {
    if (await writeSave(db, epoch, write)) persistence.publish({ player: write.player, shard: write.shard, sequence: write.seq, code: 'save-confirmed' });
  }, failed: (write, error) => {
    persistence.publish({ player: write.player, shard: write.shard, sequence: write.seq, code: 'save-failed' });
    log({ at: 'save.failed', shard: write.shard, reason: write.reason, error: String(error) });
  } });
  const reports = new ReportWriteQueue(row => writeReport(db, row), error => { log({ at: 'report.failed', error: String(error) }); });
  const read = async (device:string, shard:string, witness=false):Promise<SavedPlayer> => {
      if (!await queue.drain(3000, device, shard)) throw new Error('Player save is pending');
      const told = (issue: string): void => { log({ at: 'save.contract', shard, issue }); contract?.(issue); };
      const saved = await readSave(db, epoch, device, shard, (doc, version) => admitDoc(doc, version, shard, told));
      if (saved !== null && saved.doc === null) throw new SaveQuarantinedError('Save is quarantined: no recoverable document');
      const doc = saved?.doc ?? null, previous = saved?.previous, receipts = await recoveryReceipts(db, epoch, device, shard, Math.min(doc?.ledger.serial ?? 0, previous?.ledger.serial ?? doc?.ledger.serial ?? 0));
      const recovery = receipts.filter(row => row.serial > (doc?.ledger.serial ?? 0));
      if (doc === null && recovery.length > 0) throw new SaveQuarantinedError('Save is quarantined: receipts without a document');
      const certificate=witness && saved?.source === 'doc' && doc !== null && recovery.length === 0 ? checkpointCertificate(doc,saved.seq,shard) : undefined;
      return { doc, seq: saved?.seq ?? 0, recovery, ...(certificate===undefined?{}:{checkpoint:certificate}), ...(previous === undefined ? {} : { previous: { doc: previous, recovery: receipts.filter(row => row.serial > previous.ledger.serial) } }) };
    };
  return { queue, reports, onSave: listener => persistence.listen(listener), write: write => { queue.post(write); }, drain: async ms => (await Promise.all([queue.drain(ms), reports.drain(ms)])).every(Boolean), stats: () => ({ ...queue.stats, waiting: queue.waiting, p95Ms: Number(queue.p95.toFixed(2)), reportsWaiting: reports.waiting, reportsWritten: reports.stats.written, reportsFailed: reports.stats.failed, reportsRefused: reports.stats.refused }),
    where: async device => { if (!await queue.drain(3000, device)) throw new Error('Player save is pending'); return await placeOf(db, epoch, device) ?? await lastCell(db, epoch, device); },
    read:(device,shard)=>read(device,shard), readWitness:(device,shard)=>read(device,shard,true),
    recover: (device, shard, seq) => healSave(db, epoch, device, shard, seq),
    name: namesOver(db),
    claim: async (device, account) => { if (!await queue.drain(3000, device)) throw new Error('Player save is pending'); return claimSaves(db, device, account); },
    report: (report: ChatReport, shard: string) => { const accepted = reports.post(report, shard); if (!accepted) log({ at: 'report.refused', reason: 'backlog' }); return accepted; } };
}
/** The saves database at `url`, migrated. */
export async function openPlayerSaves(url: string, migrations: URL, epoch: number, log: (line: Record<string, unknown>) => void, contract?: (issue: string) => void): Promise<PlayerSaves> {
  const heard = (error: Error): void => { log({ at: 'database', error: error.message }); }, db = openPg(url, heard);
  log({ at: 'migrated', applied: await migrate(db, migrations) });
  return playerSavesOver(db, epoch, log, contract);
}
/** Saves that end with the process: a soak's, or a proof's. `DATABASE_URL=memory:` asks for it by name, so no server runs on it by accident. */
export function memoryPlayerSaves(): PlayerSaves {
  const held = new Map<string, SaveWrite>();
  return { where: device => { const last = [...held.values()].reverse().find(row => row.player === device); return Promise.resolve(last === undefined ? null : last.cell ?? last.shard); }, read: (device, shard) => { try { const row = held.get(`${device}\0${shard}`); return Promise.resolve({ doc: row === undefined ? null : admitDoc(row.doc, row.saveVersion, shard), seq: row?.seq ?? 0 }); } catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))); } },
    // WR7: as Postgres does, an older server's doc never lands on a newer one.
    write: write => { const key = `${write.player}\0${write.shard}`, prior = held.get(key); if (prior === undefined || prior.saveVersion <= write.saveVersion) held.set(key, write); }, report: () => true, drain: () => Promise.resolve(true),
    // MP2.2d, as `saves/claim.ts`: the device's rows move to an account with none.
    claim: (device, account) => {
      const rows = [...held.values()];
      if (rows.some(row => row.player === account)) return Promise.resolve('kept');
      const moving = rows.filter(row => row.player === device);
      for (const row of moving) { held.delete(`${device}\0${row.shard}`); held.set(`${account}\0${row.shard}`, { ...row, player: account }); }
      return Promise.resolve(moving.length > 0 ? 'moved' : 'none');
    } };
}
