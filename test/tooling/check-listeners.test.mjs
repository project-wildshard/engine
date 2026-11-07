import {describe, expect, test} from 'vitest';
import {allowedBy, isLoopback, judge, parseNetstat} from '../../scripts/check-listeners.mjs';

const columns = '0            0  131072  131072';

/**
 * @param {string} local
 * @param {string} owner
 */
const tcp = (local, owner) =>
  `tcp4       0      0  ${local.padEnd(22)} *.*                    LISTEN                 ${columns}    ${owner}   00100`;

/**
 * @param {string} local
 * @param {string} owner
 */
const udp = (local, owner) =>
  `udp4       0      0  ${local.padEnd(22)} *.*                                           0            0  786896    9216    ${owner}   00100`;

const header = [
  'Active Internet connections (including servers)',
  'Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)',
].join('\n');

/** @param {string[]} rows */
const refused = (rows) => judge(parseNetstat([header, ...rows].join('\n'))).refused.map(({process, port}) => `${process}:${port}`);

describe('parseNetstat', () => {
  test('reads protocol, address, port, process and pid', () => {
    expect(parseNetstat(tcp('*.5000', 'ControlCenter:707'))).toEqual([
      {proto: 'tcp', address: '*', port: 5000, process: 'ControlCenter', pid: 707},
    ]);
    expect(parseNetstat(tcp('127.0.0.1.4400', 'node:6298'))[0]).toMatchObject({address: '127.0.0.1', port: 4400});
    expect(parseNetstat(tcp('fe80::1%lo0.8021', 'launchd:1'))[0]).toMatchObject({address: 'fe80::1%lo0', port: 8021});
  });

  test('keeps a process name with spaces', () => {
    expect(parseNetstat(udp('*.5353', 'Google Chrome He:2409'))[0]).toMatchObject({process: 'Google Chrome He', pid: 2409});
  });

  test('counts the IPv4 and IPv6 rows of one socket once', () => {
    const ipv6 = tcp('*.5900', 'launchd:1').replace('tcp4', 'tcp6');
    expect(parseNetstat([tcp('*.5900', 'launchd:1'), ipv6].join('\n'))).toHaveLength(1);
  });

  test('skips connections, unbound UDP sockets and headers', () => {
    const connected = 'tcp4       0      0  192.168.1.5.52000      142.250.1.1.443        ESTABLISHED   0 0 131072 131072 node:6298 00100';
    const quic = 'udp6       0      0  2806:10be:d:9203.54774 2607:f8b0:4012:8.443   12552 5765 1048576 29040 Google Chrome He:2409 00102';
    const unbound = 'udp4       0      0  *.*                    *.*                    0 0 786896 9216 Signal Helper (R:16490 00000';
    expect(parseNetstat([header, connected, quic, unbound].join('\n'))).toEqual([]);
  });

  test('an unnamed listener still counts, and fails', () => {
    const bare = 'tcp4       0      0  *.9321                 *.*                    LISTEN';
    expect(refused([bare])).toEqual(['?:9321']);
  });
});

describe('judge', () => {
  test('the Mac listeners NI4 found pass', () => {
    expect(refused([
      tcp('*.5000', 'ControlCenter:707'),
      tcp('*.7000', 'ControlCenter:707'),
      tcp('*.5900', 'launchd:1'),
      tcp('*.51445', 'rapportd:675'),
      tcp('*.88', 'kdc:407'),
      udp('*.3722', 'rapportd:675'),
      udp('*.49587', 'sharingd:700'),
      udp('*.65361', 'replicatord:800'),
      udp('*.88', 'kdc:407'),
      udp('*.5353', 'mDNSResponder:440'),
      udp('*.137', 'netbiosd:390'),
      udp('*.138', 'netbiosd:390'),
    ])).toEqual([]);
  });

  test('localhost needs no allowlist', () => {
    expect(['127.0.0.1', '::1', 'fe80::1%lo0'].every(isLoopback)).toBe(true);
    expect(refused([tcp('127.0.0.1.4400', 'node:6298'), tcp('::1.8021', 'launchd:1')])).toEqual([]);
  });

  test('the orphan debug proxy fails', () => {
    expect(refused([tcp('*.9321', 'ios_webkit_debug_proxy:48952')])).toEqual(['ios_webkit_debug_proxy:9321']);
  });

  test('a server on every interface or a LAN address fails', () => {
    expect(refused([tcp('*.4400', 'node:6298')])).toEqual(['node:4400']);
    expect(refused([tcp('192.168.1.5.4400', 'node:6298')])).toEqual(['node:4400']);
    expect(refused([tcp('100.64.0.1.4400', 'node:6298')])).toEqual(['node:4400']);
  });

  test('an allowlisted port does not pass another process, nor an allowlisted process another port', () => {
    expect(refused([tcp('*.5000', 'node:6298')])).toEqual(['node:5000']);
    expect(refused([tcp('*.22', 'launchd:1')])).toEqual(['launchd:22']);
  });

  test('a TCP allowance does not cover UDP', () => {
    expect(allowedBy({proto: 'udp', address: '*', port: 5000, process: 'ControlCenter', pid: 707})).toBeUndefined();
  });
});
