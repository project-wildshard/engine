import type { Database } from './database';

export interface ZoneEntryTotal { readonly slug: string; readonly humans: number; readonly agents: number }
export interface ZoneEntryDay extends ZoneEntryTotal { readonly day: string }
interface HumanDay { readonly day: string; readonly player_key: string }
export interface ZoneEntryBatch {
  readonly id: string;
  readonly counts: readonly ZoneEntryDay[];
  readonly players: readonly HumanDay[];
}
export interface ZoneEntryStore {
  write: (channel: string, batch: ZoneEntryBatch) => Promise<void>;
  totals: (channel: string, since: string) => Promise<readonly ZoneEntryTotal[]>;
}

const accept = 'insert into zone_enter_batches (channel, id) values ($1, $2) on conflict do nothing returning id';
const counts = `insert into zone_enters (channel, slug, day, humans, agents)
  select $1, slug, day, humans, agents
  from jsonb_to_recordset($2::jsonb) as rows(slug text, day date, humans bigint, agents bigint)
  on conflict (channel, slug, day) do update set
    humans = zone_enters.humans + excluded.humans, agents = zone_enters.agents + excluded.agents`;
const players = `insert into human_players (channel, day, player_key)
  select $1, day, player_key from jsonb_to_recordset($2::jsonb) as rows(day date, player_key text)
  on conflict do nothing`;

export function zoneEntryStore(db: Database): ZoneEntryStore {
  return {
    async write(channel, batch) {
      await db.transaction(async sql => {
        if ((await sql.query(accept, [channel, batch.id])).rows.length === 0) return;
        await sql.query(counts, [channel, JSON.stringify(batch.counts)]);
        await sql.query(players, [channel, JSON.stringify(batch.players)]);
      });
    },
    async totals(channel, since) {
      const { rows } = await db.query(`select slug, sum(humans) as humans, sum(agents) as agents
        from zone_enters where channel = $1 and day >= $2::date group by slug`, [channel, since]);
      return (rows as readonly { slug: string; humans: string; agents: string }[])
        .map(({ slug, humans, agents }) => ({ slug, humans: Number(humans), agents: Number(agents) }));
    },
  };
}

/** An explicitly memory-only world uses the same aggregate contract. */
export function memoryZoneEntryStore(): ZoneEntryStore {
  const seen = new Set<string>(), days = new Map<string, Map<string, ZoneEntryDay>>();
  return {
    write(channel, batch) {
      const identity = `${channel}/${batch.id}`;
      if (seen.has(identity)) return Promise.resolve();
      seen.add(identity);
      const table = days.get(channel) ?? new Map<string, ZoneEntryDay>();
      days.set(channel, table);
      for (const row of batch.counts) {
        const key = `${row.day}/${row.slug}`, before = table.get(key);
        table.set(key, { ...row, humans: row.humans + (before?.humans ?? 0), agents: row.agents + (before?.agents ?? 0) });
      }
      return Promise.resolve();
    },
    totals(channel, since) {
      const rows = new Map<string, ZoneEntryTotal>();
      for (const { day, slug, humans, agents } of days.get(channel)?.values() ?? []) {
        if (day < since) continue;
        const before = rows.get(slug);
        rows.set(slug, { slug, humans: humans + (before?.humans ?? 0), agents: agents + (before?.agents ?? 0) });
      }
      return Promise.resolve([...rows.values()]);
    },
  };
}
