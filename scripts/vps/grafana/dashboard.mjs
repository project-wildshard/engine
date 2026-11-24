#!/usr/bin/env node
// MMO-OBSERVABILITY OB7 (meta docs/plans/MMO-OBSERVABILITY-PLAN.md; Jake, 2026-11-24: "I need baseline metrics & observability and a
// dashboard to look at and see whats going on"): the box's one Grafana dashboard, built from the panel list below so it stays
// reviewable. Every suspect for a lag sits on the same time axis with a shared crosshair: the box, its processes (the cook, Postgres,
// an agent's build), each Node thread (event loop, GC), the MMO tick and link, and the page's own frames and round trips.
//   node scripts/vps/grafana/dashboard.mjs           write scripts/vps/grafana/wildshard.json
//   node scripts/vps/grafana/dashboard.mjs --check   exit 1 when the file is stale (test/vps-grafana.test.ts runs it)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DS = { type: 'prometheus', uid: 'wildshard-prometheus' };
const C = 'channel="$channel"', A = 'actor=~"$actor"';
const W = '$__rate_interval';

/** @typedef {{ expr: string, legend?: string }} Query */
/** @typedef {{ title: string, unit?: string, queries: Query[], w?: number, h?: number, stack?: boolean, max?: number, description?: string, thresholds?: number[] }} Panel */

/** @type {readonly { title: string, panels: Panel[] }[]} */
export const ROWS = [
  { title: 'Lag suspects: one time axis', panels: [
    { title: 'Box CPU busy, steal, iowait', unit: 'percent', max: 100, description: 'All 16 cores. Steal is the host taking CPU away; iowait is the disk.', thresholds: [70], queries: [
      { expr: `100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[${W}])))`, legend: 'busy' },
      { expr: `100 * avg(rate(node_cpu_seconds_total{mode="steal"}[${W}]))`, legend: 'steal' },
      { expr: `100 * avg(rate(node_cpu_seconds_total{mode="iowait"}[${W}]))`, legend: 'iowait' },
      { expr: `100 * max(rate(node_cpu_seconds_total{mode!="idle"}[${W}]))`, legend: 'busiest core (all modes)' }] },
    { title: 'Door event loop (holds every socket)', unit: 'ms', description: 'The main thread: a stall here holds every client\'s frames and pongs.', thresholds: [50], queries: [
      { expr: `1000 * wildshard_eventloop_lag_seconds{${C},thread="main",quantile="0.99"}`, legend: 'p99' },
      { expr: `1000 * wildshard_eventloop_lag_seconds{${C},thread="main",quantile="1"}`, legend: 'max' }] },
    { title: 'Worker event loops (hold the ticks)', unit: 'ms', thresholds: [50], queries: [
      { expr: `1000 * max(wildshard_eventloop_lag_seconds{${C},thread=~"worker-.*",quantile="0.99"})`, legend: 'worst p99' },
      { expr: `1000 * max(wildshard_eventloop_lag_seconds{${C},thread=~"worker-.*",quantile="1"})`, legend: 'worst max' }] },
    { title: 'Longest GC pause, any thread', unit: 'ms', thresholds: [50], queries: [
      { expr: `1000 * max by (thread) (wildshard_gc_pause_max_seconds{${C}})`, legend: '{{thread}}' }] },
    { title: 'Tick time, worst worker', unit: 'ms', description: 'A 60 Hz tick has 16.7 ms.', thresholds: [16.7], queries: [
      { expr: `1000 * max(wildshard_tick_seconds{${C},quantile="0.99"})`, legend: 'p99' },
      { expr: `1000 * max(wildshard_tick_seconds{${C},quantile="1"})`, legend: 'max' },
      { expr: `sum(increase(wildshard_tick_drops_total{${C}}[1m]))`, legend: 'dropped ticks / min' }] },
    { title: 'Client round trip (the network)', unit: 'ms', description: 'Each ping, as the page measured it.', thresholds: [250], queries: [
      { expr: `1000 * histogram_quantile(0.5, sum by (le) (rate(wildshard_client_rtt_seconds_bucket{${C},${A}}[${W}])))`, legend: 'p50' },
      { expr: `1000 * histogram_quantile(0.95, sum by (le) (rate(wildshard_client_rtt_seconds_bucket{${C},${A}}[${W}])))`, legend: 'p95' },
      { expr: `1000 * histogram_quantile(0.95, sum by (le) (rate(wildshard_client_rtt_jitter_seconds_bucket{${C},${A}}[${W}])))`, legend: 'jitter p95' }] },
    { title: 'Client frames (the phone)', unit: 'short', description: 'fps per 10 s word, and frames over 50 ms per minute.', queries: [
      { expr: `histogram_quantile(0.5, sum by (le, device) (rate(wildshard_client_fps_bucket{${C},${A}}[${W}])))`, legend: 'fps p50 {{device}}' },
      { expr: `60 * sum by (device) (rate(wildshard_client_long_frames_total{${C},${A}}[${W}]))`, legend: 'long frames/min {{device}}' }] },
    { title: 'Reconnects and closes per minute', unit: 'short', thresholds: [3], queries: [
      { expr: `sum by (reason) (increase(wildshard_client_reconnects_total{${C},${A}}[1m]))`, legend: 'page lost link: {{reason}}' },
      { expr: `sum by (reason) (increase(wildshard_socket_closes_total{${C},${A},reason!="closed"}[1m]))`, legend: 'door closed: {{reason}}' }] },
  ] },
  { title: 'The box', panels: [
    { title: 'CPU by mode', unit: 'percent', stack: true, queries: [{ expr: `100 * sum by (mode) (rate(node_cpu_seconds_total{mode!="idle"}[${W}])) / scalar(count(count by (cpu) (node_cpu_seconds_total)))`, legend: '{{mode}}' }] },
    { title: 'Load', unit: 'short', queries: [{ expr: 'node_load1', legend: '1 min' }, { expr: 'node_load5', legend: '5 min' }, { expr: 'count(count by (cpu) (node_cpu_seconds_total))', legend: 'cores' }] },
    { title: 'Pressure (time stalled)', unit: 'percentunit', description: 'Linux PSI: share of time some task waited on CPU, memory or I/O.', queries: [
      { expr: `rate(node_pressure_cpu_waiting_seconds_total[${W}])`, legend: 'cpu' },
      { expr: `rate(node_pressure_memory_waiting_seconds_total[${W}])`, legend: 'memory' },
      { expr: `rate(node_pressure_io_waiting_seconds_total[${W}])`, legend: 'io' }] },
    { title: 'Memory', unit: 'bytes', queries: [
      { expr: 'node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes', legend: 'used' },
      { expr: 'node_memory_MemAvailable_bytes', legend: 'available' },
      { expr: 'node_memory_SwapTotal_bytes - node_memory_SwapFree_bytes', legend: 'swap used' }] },
    { title: 'Disk I/O', unit: 'Bps', queries: [
      { expr: `sum(rate(node_disk_read_bytes_total{device!~"sr.*"}[${W}]))`, legend: 'read' },
      { expr: `sum(rate(node_disk_written_bytes_total{device!~"sr.*"}[${W}]))`, legend: 'write' }] },
    { title: 'Disk used', unit: 'percent', max: 100, queries: [{ expr: '100 * (1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})', legend: '/' }] },
    { title: 'Network', unit: 'Bps', queries: [
      { expr: `rate(node_network_receive_bytes_total{device=~"eth0|tailscale0"}[${W}])`, legend: 'in {{device}}' },
      { expr: `rate(node_network_transmit_bytes_total{device=~"eth0|tailscale0"}[${W}])`, legend: 'out {{device}}' }] },
    { title: 'TCP', unit: 'short', queries: [
      { expr: `rate(node_netstat_Tcp_RetransSegs[${W}])`, legend: 'retransmits/s' },
      { expr: 'node_netstat_Tcp_CurrEstab', legend: 'established' }] },
  ] },
  { title: 'Processes (who is using the box)', panels: [
    { title: 'CPU by account', unit: 'short', w: 12, stack: true, description: 'Cores in use. wildshard-cook is the cook; wildshard-staging and wildshard-production the game servers; wildshard-agent an agent\'s work.', queries: [
      { expr: `sum by (groupname) (rate(namedprocess_namegroup_cpu_seconds_total[${W}]))`, legend: '{{groupname}}' }] },
    { title: 'Resident memory by account', unit: 'bytes', w: 12, stack: true, queries: [
      { expr: 'sum by (groupname) (namedprocess_namegroup_memory_bytes{memtype="resident"})', legend: '{{groupname}}' }] },
    { title: 'Disk I/O by account', unit: 'Bps', w: 12, queries: [
      { expr: `sum by (groupname) (rate(namedprocess_namegroup_read_bytes_total[${W}]) + rate(namedprocess_namegroup_write_bytes_total[${W}]))`, legend: '{{groupname}}' }] },
    { title: 'Processes by account', unit: 'short', w: 12, queries: [{ expr: 'sum by (groupname) (namedprocess_namegroup_num_procs)', legend: '{{groupname}}' }] },
  ] },
  { title: 'The Node server ($channel)', panels: [
    { title: 'Process CPU', unit: 'short', description: 'Cores, door and workers together.', queries: [{ expr: `rate(process_cpu_seconds_total{${C}}[${W}])`, legend: 'cores' }] },
    { title: 'Memory', unit: 'bytes', queries: [
      { expr: `process_resident_memory_bytes{${C}}`, legend: 'rss' },
      { expr: `wildshard_thread_memory_bytes{${C},kind="heap"}`, legend: 'heap {{thread}}' }] },
    { title: 'Event loop p99 per thread', unit: 'ms', queries: [{ expr: `1000 * wildshard_eventloop_lag_seconds{${C},quantile="0.99"}`, legend: '{{thread}}' }] },
    { title: 'GC time per second, per thread', unit: 'percentunit', description: 'Share of each thread\'s time paused for GC.', queries: [
      { expr: `sum by (thread) (rate(wildshard_gc_pause_seconds_total{${C}}[${W}]))`, legend: '{{thread}}' }] },
    { title: 'GC pauses per minute, by kind', unit: 'short', queries: [{ expr: `60 * sum by (kind) (rate(wildshard_gc_pauses_total{${C}}[${W}]))`, legend: '{{kind}}' }] },
    { title: 'Door GC p99 by kind', unit: 'ms', queries: [{ expr: `1000 * histogram_quantile(0.99, sum by (le, kind) (rate(nodejs_gc_duration_seconds_bucket{${C}}[${W}])))`, legend: '{{kind}}' }] },
    { title: 'Handles and file descriptors', unit: 'short', queries: [
      { expr: `nodejs_active_handles_total{${C}}`, legend: 'handles' },
      { expr: `process_open_fds{${C}}`, legend: 'fds' }] },
    { title: 'Restarts', unit: 'short', queries: [{ expr: `changes(process_start_time_seconds{${C}}[1h])`, legend: 'starts in the last hour' }] },
  ] },
  { title: 'The MMO ($channel)', panels: [
    { title: 'Players', unit: 'short', queries: [
      { expr: `sum(wildshard_players{${C}})`, legend: 'seated' },
      { expr: `sum(wildshard_players_held{${C}})`, legend: 'held (dropped, body standing)' },
      { expr: `sum by (actor, device) (wildshard_sockets_open{${C}})`, legend: 'sockets {{actor}} {{device}}' }] },
    { title: 'Ticks per second per worker', unit: 'short', queries: [{ expr: `wildshard_ticks_per_second{${C}}`, legend: 'worker {{worker}}' }] },
    { title: 'Tick p99 per worker', unit: 'ms', queries: [{ expr: `1000 * wildshard_tick_seconds{${C},quantile="0.99"}`, legend: 'worker {{worker}}' }] },
    { title: 'Send queue (backpressure)', unit: 'bytes', description: 'The most bytes waiting for one client; frames skip past 16 KiB and the client is closed stalled past 256 KiB.', queries: [
      { expr: `wildshard_socket_buffered_bytes_max{${C}}`, legend: 'worst client' }] },
    { title: 'Skipped frames per minute', unit: 'short', queries: [{ expr: `60 * rate(wildshard_socket_skipped_frames_total{${C}}[${W}])`, legend: 'skipped' }] },
    { title: 'Socket bytes', unit: 'Bps', queries: [{ expr: `rate(wildshard_socket_bytes_total{${C}}[${W}])`, legend: '{{direction}}' }] },
    { title: 'Door refusals per minute (protocol errors, limits)', unit: 'short', queries: [{ expr: `sum by (reason) (increase(wildshard_door_refusals_total{${C}}[1m]))`, legend: '{{reason}}' }] },
    { title: 'Crossings p95', unit: 's', queries: [{ expr: `histogram_quantile(0.95, sum by (le) (rate(wildshard_crossing_seconds_bucket{${C}}[5m])))`, legend: 'p95' }] },
  ] },
  { title: 'The page ($channel, from each client\'s 10 s word)', panels: [
    { title: 'fps by device', unit: 'short', queries: [
      { expr: `histogram_quantile(0.5, sum by (le, device) (rate(wildshard_client_fps_bucket{${C},${A}}[${W}])))`, legend: 'p50 {{device}}' },
      { expr: `histogram_quantile(0.1, sum by (le, device) (rate(wildshard_client_fps_bucket{${C},${A}}[${W}])))`, legend: 'worst 10% {{device}}' }] },
    { title: 'Frame times', unit: 's', queries: [
      { expr: `histogram_quantile(0.5, sum by (le, device) (rate(wildshard_client_frame_p95_seconds_bucket{${C},${A}}[${W}])))`, legend: 'typical p95 {{device}}' },
      { expr: `histogram_quantile(0.95, sum by (le, device) (rate(wildshard_client_frame_max_seconds_bucket{${C},${A}}[${W}])))`, legend: 'worst frame {{device}}' }] },
    { title: 'Share of frames over 50 ms', unit: 'percentunit', queries: [
      { expr: `sum by (device) (rate(wildshard_client_long_frames_total{${C},${A}}[${W}])) / sum by (device) (rate(wildshard_client_frames_total{${C},${A}}[${W}]))`, legend: '{{device}}' }] },
    { title: 'Round trip by device', unit: 's', queries: [
      { expr: `histogram_quantile(0.5, sum by (le, device) (rate(wildshard_client_rtt_seconds_bucket{${C},${A}}[${W}])))`, legend: 'p50 {{device}}' },
      { expr: `histogram_quantile(0.99, sum by (le, device) (rate(wildshard_client_rtt_seconds_bucket{${C},${A}}[${W}])))`, legend: 'p99 {{device}}' }] },
    { title: 'Pages reporting', unit: 'short', queries: [{ expr: `10 * sum by (actor, device) (rate(wildshard_client_stats_words_total{${C},${A}}[${W}]))`, legend: '{{actor}} {{device}}' }] },
    { title: 'Links lost, by reason, per minute', unit: 'short', queries: [{ expr: `sum by (reason, device) (increase(wildshard_client_reconnects_total{${C},${A}}[1m]))`, legend: '{{reason}} {{device}}' }] },
  ] },
];

/** Markers on every panel: restarts and releases, the cook at work, and reconnect storms. */
export const ANNOTATIONS = [
  { name: 'Restart or deploy', iconColor: 'orange', expr: `changes(process_start_time_seconds{job="wildshard",${C}}[1m]) > 0`, titleFormat: 'restart', step: '60s' },
  { name: 'Release (new build)', iconColor: 'purple', expr: `wildshard_build_info{${C}} unless wildshard_build_info{${C}} offset 2m`, titleFormat: 'build {{build}} serial {{serial}}', step: '60s' },
  { name: 'Cook busy', iconColor: 'yellow', expr: 'sum(rate(namedprocess_namegroup_cpu_seconds_total{groupname="wildshard-cook"}[1m])) > 0.5', titleFormat: 'cook', step: '60s' },
  { name: 'Reconnect storm', iconColor: 'red', expr: `(sum(increase(wildshard_client_reconnects_total{${C}}[1m])) or vector(0)) + (sum(increase(wildshard_socket_closes_total{${C},reason!~"closed|replaced"}[1m])) or vector(0)) > 3`, titleFormat: 'reconnect storm', step: '60s' },
];

/** The dashboard as Grafana reads it. */
export function dashboard() {
  const panels = [];
  let y = 0, id = 1;
  for (const row of ROWS) {
    panels.push({ type: 'row', id: id++, title: row.title, collapsed: false, gridPos: { x: 0, y: y++, w: 24, h: 1 }, panels: [] });
    let x = 0, rowH = 0;
    for (const panel of row.panels) {
      const w = panel.w ?? 6, h = panel.h ?? 7;
      if (x + w > 24) { x = 0; y += rowH; rowH = 0; }
      panels.push({
        type: 'timeseries', id: id++, title: panel.title, ...(panel.description === undefined ? {} : { description: panel.description }), datasource: DS,
        gridPos: { x, y, w, h },
        targets: panel.queries.map((query, at) => ({ datasource: DS, refId: String.fromCodePoint(65 + at), expr: query.expr, legendFormat: query.legend ?? '__auto', range: true })),
        fieldConfig: { defaults: { unit: panel.unit ?? 'short', ...(panel.max === undefined ? {} : { max: panel.max }), min: 0,
          custom: { drawStyle: 'line', lineWidth: 1, fillOpacity: panel.stack === true ? 30 : 8, showPoints: 'never', spanNulls: false, ...(panel.stack === true ? { stacking: { mode: 'normal', group: 'A' } } : {}),
            ...(panel.thresholds === undefined ? {} : { thresholdsStyle: { mode: 'dashed' } }) },
          ...(panel.thresholds === undefined ? {} : { thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, ...panel.thresholds.map(value => ({ color: 'red', value }))] } }) },
          overrides: [] },
        options: { legend: { displayMode: 'list', placement: 'bottom', showLegend: true }, tooltip: { mode: 'multi', sort: 'desc' } },
      });
      x += w; rowH = Math.max(rowH, h);
    }
    y += rowH;
  }
  return {
    uid: 'wildshard-lag', title: 'Wildshard: why did it lag?', tags: ['wildshard'], timezone: 'browser', editable: false, graphTooltip: 1, schemaVersion: 39, version: 1,
    time: { from: 'now-24h', to: 'now' }, refresh: '1m',
    timepicker: { refresh_intervals: ['30s', '1m', '5m'], quick_ranges: [
      { from: 'now-1h', to: 'now', display: 'Last 1 hour' }, { from: 'now-24h', to: 'now', display: 'Last 24 hours' }, { from: 'now-7d', to: 'now', display: 'Last 7 days' }] },
    links: [
      { title: 'Last 1 h', type: 'link', url: '/d/wildshard-lag?from=now-1h&to=now', keepTime: false, includeVars: true },
      { title: 'Last 24 h', type: 'link', url: '/d/wildshard-lag?from=now-24h&to=now', keepTime: false, includeVars: true },
      { title: 'Last 7 d', type: 'link', url: '/d/wildshard-lag?from=now-7d&to=now', keepTime: false, includeVars: true }],
    templating: { list: [
      { name: 'channel', label: 'Channel', type: 'custom', query: 'staging,production', current: { text: 'staging', value: 'staging' },
        options: [{ text: 'staging', value: 'staging', selected: true }, { text: 'production', value: 'production', selected: false }] },
      { name: 'actor', label: 'Players', type: 'custom', query: 'human,agent', includeAll: true, allValue: 'human|agent', multi: false, current: { text: 'All', value: '$__all' },
        options: [{ text: 'All', value: '$__all', selected: true }, { text: 'human', value: 'human', selected: false }, { text: 'agent', value: 'agent', selected: false }] }] },
    annotations: { list: [
      { builtIn: 1, datasource: { type: 'grafana', uid: '-- Grafana --' }, enable: true, hide: true, iconColor: 'rgba(0, 211, 255, 1)', name: 'Annotations & Alerts', type: 'dashboard' },
      ...ANNOTATIONS.map(row => ({ datasource: DS, enable: true, iconColor: row.iconColor, name: row.name, expr: row.expr, step: row.step, titleFormat: row.titleFormat, useValueForTime: false }))] },
    panels,
  };
}

/** Every metric name a query reads, for the test that holds them to what the code and exporters export. */
export function metricNames() {
  const names = new Set(), exprs = [...ROWS.flatMap(row => row.panels.flatMap(panel => panel.queries.map(query => query.expr))), ...ANNOTATIONS.map(row => row.expr)];
  for (const expr of exprs) for (const [name] of expr.matchAll(/\b(?:wildshard|node|namedprocess|nodejs|process)_[a-zA-Z0-9_]+/gu)) names.add(name);
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const OUT = fileURLToPath(new URL('wildshard.json', import.meta.url));
if (process.argv[1] === import.meta.filename) {
  const text = `${JSON.stringify(dashboard(), null, 1)}\n`;
  if (process.argv.includes('--check')) {
    let now = '';
    try { now = readFileSync(OUT, 'utf8'); } catch { /* missing is stale */ }
    if (now !== text) { console.error('scripts/vps/grafana/wildshard.json is stale: node scripts/vps/grafana/dashboard.mjs'); process.exit(1); }
  } else writeFileSync(OUT, text);
}
