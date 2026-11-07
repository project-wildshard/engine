#!/usr/bin/env node
// J148: fail on any listener outside localhost that is not on the allowlist below. CI can't see the Mac, so this is a
// local command (`pnpm check:listeners`). browser-lane.sh runs it with --warn at lane start: it prints and never blocks,
// because a lane must not wait on a macOS service. netstat, not lsof: without root, lsof can't see launchd's or kdc's
// sockets. Why, and the sockets found on 2026-11-06: meta docs/plans/NOVEMBER-IDEAS.md NI4.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {{proto: string, address: string, port: number, process: string, pid: number}} Listener
 * @typedef {{proto: string, why: string, process?: string, ports?: number[]}} Allowed
 */

// The macOS services this Mac runs. An entry names a process, a port, or both, and the narrowest that holds: launchd
// owns any socket-activated port, so only its Screen Sharing port passes, and Remote Login on 22 would fail.
/** @type {Allowed[]} */
export const ALLOWED = [
  { proto: 'tcp', process: 'ControlCenter', ports: [5000, 7000], why: 'AirPlay Receiver' },
  { proto: 'tcp', process: 'launchd', ports: [5900], why: 'Screen Sharing' },
  { proto: 'tcp', process: 'rapportd', why: 'Continuity' }, // its port is random
  { proto: 'tcp', process: 'kdc', ports: [88], why: 'Kerberos' },
  { proto: 'udp', process: 'kdc', ports: [88], why: 'Kerberos' },
  { proto: 'udp', process: 'rapportd', why: 'Continuity' },
  { proto: 'udp', process: 'sharingd', why: 'AirDrop and Handoff' },
  { proto: 'udp', process: 'replicatord', why: 'Widget and app sync' },
  { proto: 'udp', process: 'netbiosd', ports: [137, 138], why: 'NetBIOS name lookup' },
  { proto: 'udp', ports: [5353], why: 'mDNS' }, // mDNSResponder, and any app that browses
];

/** @param {string} line */
function parseRow(line) {
  const row = /^(tcp|udp)\d*\s+\d+\s+\d+\s+(\S+)\s+(\S+)(?:\s+(LISTEN\b))?/.exec(line);
  if (!row) return null;
  const [, proto = '', local = '', foreign = '', state] = row;
  const listening = proto === 'tcp' ? state !== undefined : foreign === '*.*';
  const dot = local.lastIndexOf('.');
  const port = Number(local.slice(dot + 1));
  if (!listening || !Number.isInteger(port)) return null; // an unbound `*.*` UDP socket has no port to reach
  // A row with no process column still counts: an unnamed listener must fail, never vanish.
  const owner = /^\s*(?:\d+\s+)*(\S.*?):(\d+)\s+[0-9a-f]{5}\b/.exec(line.slice(row[0].length));
  return { proto, address: local.slice(0, dot), port, process: owner?.[1] ?? '?', pid: Number(owner?.[2] ?? 0) };
}

/**
 * Sockets accepting from elsewhere, from `netstat -anv` output; IPv4 and IPv6 rows of one socket count once.
 * @param {string} output
 * @returns {Listener[]}
 */
export function parseNetstat(output) {
  const seen = new Map();
  for (const line of output.split('\n')) {
    const listener = parseRow(line);
    if (listener) seen.set([listener.proto, listener.address, listener.port, listener.process].join(' '), listener);
  }
  return [...seen.values()];
}

/** @param {string} address */
export function isLoopback(address) {
  return address.startsWith('127.') || address === '::1' || address.endsWith('%lo0');
}

/**
 * @param {Listener} listener
 * @returns {Allowed | undefined}
 */
export function allowedBy(listener) {
  return ALLOWED.find((entry) => entry.proto === listener.proto
    && (entry.process === undefined || entry.process === listener.process)
    && (entry.ports === undefined || entry.ports.includes(listener.port)));
}

/**
 * @param {Listener[]} listeners
 * @returns {{allowed: Listener[], refused: Listener[]}}
 */
export function judge(listeners) {
  const outside = listeners.filter((listener) => !isLoopback(listener.address));
  return {
    allowed: outside.filter((listener) => allowedBy(listener)),
    refused: outside.filter((listener) => !allowedBy(listener)),
  };
}

/** @param {Listener} listener */
const describe = (listener) =>
  `${listener.proto} ${listener.address}:${listener.port} ${listener.process}${listener.pid ? ` (pid ${listener.pid})` : ''}`;

/** @param {string} protocol */
const netstat = (protocol) =>
  execFileSync('netstat', ['-anv', '-p', protocol], { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] });

function main() {
  const warnOnly = process.argv.includes('--warn');
  if (process.platform !== 'darwin') {
    if (!warnOnly) console.log('check-listeners: skipped, it reads the shared Mac');
    return 0;
  }
  let verdict;
  try {
    verdict = judge(parseNetstat(netstat('tcp') + netstat('udp')));
  } catch (error) {
    if (warnOnly) return 0;
    throw error;
  }
  const { allowed, refused } = verdict;
  if (refused.length > 0) {
    const label = `check-listeners: ${refused.length} listener(s) outside localhost, not on the allowlist`;
    console.error(`${label}:\n${refused.map((listener) => `  ${describe(listener)}`).join('\n')}`);
    console.error('Bind it to 127.0.0.1 or stop it. A macOS service goes in ALLOWED in scripts/check-listeners.mjs.');
    return warnOnly ? 0 : 1;
  }
  if (!warnOnly) {
    const names = [...new Set(allowed.map((listener) => allowedBy(listener)?.why ?? '?'))].join(', ');
    console.log(`check-listeners: clean. ${allowed.length} allowlisted outside localhost: ${names}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main());
