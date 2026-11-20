import type { Database } from './database';

export interface ZoneFunnelTotal { readonly slug: string; readonly humans: number; readonly agents: number }
export interface ZoneEntryTotal extends ZoneFunnelTotal { readonly uniqueHumans: number }
export interface ZoneEntryDay extends ZoneFunnelTotal { readonly day: string }
interface HumanDay { readonly day: string; readonly slug: string; readonly player_key: string }
export interface ZoneEntryBatch {
  readonly id: string;
  readonly counts: readonly ZoneEntryDay[];
  readonly players: readonly HumanDay[];
  readonly presses?: readonly ZoneEntryDay[];
}
export interface ZoneEntryStore {
  write: (channel: string, batch: ZoneEntryBatch) => Promise<void>;
  totals: (channel: string, since: string) => Promise<readonly ZoneEntryTotal[]>;
  pressTotals: (channel: string, since: string) => Promise<readonly ZoneFunnelTotal[]>;
}

const accept = 'insert into zone_enter_batches (channel, id) values ($1, $2) on conflict do nothing returning id';
const writeDays = (table: 'zone_enters' | 'zone_select_presses'): string => `insert into ${table} (channel, slug, day, humans, agents)
  select $1, slug, day, humans, agents
  from jsonb_to_recordset($2::jsonb) as rows(slug text, day date, humans bigint, agents bigint)
  on conflict (channel, slug, day) do update set
    humans = ${table}.humans + excluded.humans, agents = ${table}.agents + excluded.agents`;
const counts = writeDays('zone_enters'), presses = writeDays('zone_select_presses');
const players = `insert into human_players (channel, day, player_key)
  select $1, day, player_key from jsonb_to_recordset($2::jsonb) as rows(day date, player_key text)
  on conflict do nothing`;
const zonePlayers = `insert into zone_enter_players (channel, day, slug, player_key)
  select $1, day, slug, player_key from jsonb_to_recordset($2::jsonb) as rows(day date, slug text, player_key text)
  on conflict do nothing`;
const totals = `select visits.slug, visits.humans, visits.agents, coalesce(distinct_players.unique_humans, 0) as unique_humans
  from (select slug, sum(humans) as humans, sum(agents) as agents
    from zone_enters where channel = $1 and day >= $2::date group by slug) visits
  left join (select slug, count(distinct player_key) as unique_humans
    from zone_enter_players where channel = $1 and day >= $2::date group by slug) distinct_players using (slug)`;

export function zoneEntryStore(db: Database): ZoneEntryStore {
  return {
    async write(channel, batch) {
      await db.transaction(async sql => {
        if ((await sql.query(accept, [channel, batch.id])).rows.length === 0) return;
        await sql.query(counts, [channel, JSON.stringify(batch.counts)]);
        if (batch.presses !== undefined && batch.presses.length > 0) await sql.query(presses, [channel, JSON.stringify(batch.presses)]);
        const gamePlayers = JSON.stringify(batch.players);
        await sql.query(players, [channel, gamePlayers]);
        await sql.query(zonePlayers, [channel, gamePlayers]);
      });
    },
    async totals(channel, since) {
      const { rows } = await db.query(totals, [channel, since]);
      return (rows as readonly { slug: string; humans: string; agents: string; unique_humans: string }[])
        .map(({ slug, humans, agents, unique_humans: unique }) => ({ slug, humans: Number(humans), agents: Number(agents), uniqueHumans: Number(unique) }));
    },
    async pressTotals(channel, since) {
      const { rows } = await db.query('select slug, sum(humans) as humans, sum(agents) as agents from zone_select_presses where channel = $1 and day >= $2::date group by slug', [channel, since]);
      return (rows as readonly { slug: string; humans: string; agents: string }[])
        .map(({ slug, humans, agents }) => ({ slug, humans: Number(humans), agents: Number(agents) }));
    },
  };
}

/** An explicitly memory-only world uses the same aggregate contract. */
export function memoryZoneEntryStore(): ZoneEntryStore {
  const seen = new Set<string>(), days = new Map<string, Map<string, ZoneEntryDay>>(), playersByChannel = new Map<string, Map<string, HumanDay>>();
  const pressDays = new Map<string, Map<string, ZoneEntryDay>>();
  function addRows(table: Map<string, Map<string, ZoneEntryDay>>, channel: string, rows: readonly ZoneEntryDay[]): void {
    const channelDays = table.get(channel) ?? new Map<string, ZoneEntryDay>();
    table.set(channel, channelDays);
    for (const row of rows) {
      const key = `${row.day}/${row.slug}`, before = channelDays.get(key);
      channelDays.set(key, { ...row, humans: row.humans + (before?.humans ?? 0), agents: row.agents + (before?.agents ?? 0) });
    }
  }
  return {
    write(channel, batch) {
      const identity = `${channel}/${batch.id}`;
      if (seen.has(identity)) return Promise.resolve();
      seen.add(identity);
      addRows(days, channel, batch.counts);
      if (batch.presses !== undefined) addRows(pressDays, channel, batch.presses);
      const humans = playersByChannel.get(channel) ?? new Map<string, HumanDay>();
      playersByChannel.set(channel, humans);
      for (const row of batch.players) humans.set(`${row.day}/${row.slug}/${row.player_key}`, row);
      return Promise.resolve();
    },
    totals(channel, since) {
      const unique = new Map<string, Set<string>>();
      for (const { day, slug, player_key: key } of playersByChannel.get(channel)?.values() ?? []) {
        if (day < since) continue;
        const playersInZone = unique.get(slug) ?? new Set<string>();
        playersInZone.add(key);
        unique.set(slug, playersInZone);
      }
      const rows = new Map<string, ZoneEntryTotal>();
      for (const { day, slug, humans, agents } of days.get(channel)?.values() ?? []) {
        if (day < since) continue;
        const before = rows.get(slug);
        rows.set(slug, { slug, humans: humans + (before?.humans ?? 0), agents: agents + (before?.agents ?? 0), uniqueHumans: unique.get(slug)?.size ?? 0 });
      }
      return Promise.resolve([...rows.values()]);
    },
    pressTotals(channel, since) {
      const rows = new Map<string, ZoneFunnelTotal>();
      for (const { day, slug, humans, agents } of pressDays.get(channel)?.values() ?? []) {
        if (day < since) continue;
        const before = rows.get(slug);
        rows.set(slug, { slug, humans: humans + (before?.humans ?? 0), agents: agents + (before?.agents ?? 0) });
      }
      return Promise.resolve([...rows.values()]);
    },
  };
}
