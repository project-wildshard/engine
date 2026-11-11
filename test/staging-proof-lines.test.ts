// The staging proofs excuse exactly MS7 D7's rooms /health lines and read MP2.4 tagged Names (scripts/staging-proof-lines.mjs).
import { describe, expect, it } from 'vitest';
import { chatLinePattern, isPlayerName, isRoomsHealthLine, playerNameSource, roomsHealthURL, splitRoomsHealthLines } from '../scripts/staging-proof-lines.mjs';

const health = 'https://rooms-staging.wildshard.io/health';

describe('rooms health lines (D7)', () => {
  it('names the private health only behind a rooms socket', () => {
    expect(roomsHealthURL('wss://rooms-staging.wildshard.io')).toBe(health);
    expect(roomsHealthURL('wss://rooms-staging.wildshard.io/')).toBe(health);
    expect(roomsHealthURL('wss://rooms.wildshard.io')).toBe('https://rooms.wildshard.io/health');
    expect(roomsHealthURL('wss://wildshard.tailb41b20.ts.net:8443')).toBeNull();
  });
  it('accepts the lines ship19 saw from Chromium and WebKit', () => {
    const seen = [
      { text: "Access to fetch at 'https://rooms-staging.wildshard.io/health' from origin 'https://staging.wildshard.io' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource." },
      { text: 'Request failed https://rooms-staging.wildshard.io/health: net::ERR_FAILED' },
      { text: 'Failed to load resource: net::ERR_FAILED', url: health },
      { text: 'HTTP 404 https://rooms-staging.wildshard.io/health' },
      { text: 'Failed to load resource: the server responded with a status of 404 ()', url: health },
      { text: 'Origin https://staging.wildshard.io is not allowed by Access-Control-Allow-Origin. Status code: 404', url: health },
      { text: '/rooms-staging.wildshard.io/health due to access control checks.' },
      { text: 'Fetch API cannot load https://rooms-staging.wildshard.io/health due to access control checks.' },
      { text: 'Request failed https://rooms-staging.wildshard.io/health: Origin https://staging.wildshard.io is not allowed by Access-Control-Allow-Origin. Status code: 404' },
      { text: 'Failed to load resource: Origin https://staging.wildshard.io is not allowed by Access-Control-Allow-Origin. Status code: 404', url: `${health}?x=1` },
    ];
    for (const line of seen) expect(isRoomsHealthLine(line, health), line.text).toBe(true);
  });
  it('refuses every other line, even the same words about another address', () => {
    const other = [
      { text: 'Failed to load resource: net::ERR_FAILED' },
      { text: 'Failed to load resource: net::ERR_FAILED', url: 'https://staging.wildshard.io/b/abc/game.js' },
      { text: 'Failed to load resource: the server responded with a status of 404 ()', url: 'https://rooms-staging.wildshard.io/healthz' },
      { text: 'Origin https://staging.wildshard.io is not allowed by Access-Control-Allow-Origin. Status code: 404', url: 'https://staging.wildshard.io/' },
      { text: 'HTTP 404 https://rooms-staging.wildshard.io/healthy' },
      { text: 'HTTP 404 https://rooms-staging.wildshard.io/health/deep' },
      { text: 'HTTP 404 https://evilrooms-staging.wildshard.io/health' },
      { text: 'Request failed https://rooms.wildshard.io/health: net::ERR_FAILED' },
      { text: 'Socket error closed' },
      { text: 'TypeError: x is undefined' },
    ];
    for (const line of other) expect(isRoomsHealthLine(line, health), line.text).toBe(false);
  });
  it('excuses nothing without a rooms socket', () => {
    expect(isRoomsHealthLine({ text: 'HTTP 404 https://rooms-staging.wildshard.io/health' }, null)).toBe(false);
  });
  it('excuses WebKit\'s address-less CORS line only before its health partner on the same page', () => {
    const cors = 'Origin https://staging.wildshard.io is not allowed by Access-Control-Allow-Origin. Status code: 404', checks = '/rooms-staging.wildshard.io/health due to access control checks.';
    const paired = splitRoomsHealthLines([{ name: 'A', text: cors, url: '' }, { name: 'B', text: 'noise' }, { name: 'A', text: checks }], health);
    expect(paired.other.map(line => line.text)).toEqual(['noise']);
    const alone = splitRoomsHealthLines([{ name: 'A', text: cors, url: '' }, { name: 'B', text: checks }], health);
    expect(alone.other.map(line => line.text)).toEqual([cors]);
    const elsewhere = splitRoomsHealthLines([{ text: cors }, { text: '/staging.wildshard.io/api/x due to access control checks.' }], health);
    expect(elsewhere.other.map(line => line.text)).toEqual([cors, '/staging.wildshard.io/api/x due to access control checks.']);
    const last = splitRoomsHealthLines([{ text: checks }, { text: cors }], health);
    expect(last.other.map(line => line.text)).toEqual([cors]);
  });
  it('splits a page log into excused and failing lines', () => {
    const lines = [{ name: 'A', text: 'HTTP 404 https://rooms-staging.wildshard.io/health' }, { name: 'A', text: 'TypeError: boom' }];
    const { health: excused, other } = splitRoomsHealthLines(lines, health);
    expect(excused.map(line => line.text)).toEqual(['HTTP 404 https://rooms-staging.wildshard.io/health']);
    expect(other.map(line => line.text)).toEqual(['TypeError: boom']);
  });
});

describe('tagged Names (MP2.4)', () => {
  it('reads a Name with or without its tag', () => {
    expect(isPlayerName('Agent C g1mh A', 'Agent C g1mh A')).toBe(true);
    expect(isPlayerName('Agent C g1mh A#7511', 'Agent C g1mh A')).toBe(true);
    expect(isPlayerName('Agent C g1mh A#1000', 'Agent C g1mh A')).toBe(true);
  });
  it('never takes another Name or a malformed tag', () => {
    for (const shown of ['Agent C g1mh B#7511', 'Agent C g1mh AB', 'Agent C g1mh A#', 'Agent C g1mh A#0999', 'Agent C g1mh A#12345', 'Agent C g1mh A#2', 'xAgent C g1mh A'])
      expect(isPlayerName(shown, 'Agent C g1mh A'), shown).toBe(false);
    expect(isPlayerName('Agent.X', 'Agent X')).toBe(false);
    expect(new RegExp(playerNameSource('a.b'), 'u').test('axb')).toBe(false);
  });
  it('matches a chat line from a tagged sender', () => {
    const line = chatLinePattern('Agent C g1mh B', 'agent proof chromium 04e1e71');
    expect(line.test('Agent C g1mh B#4821: agent proof chromium 04e1e71')).toBe(true);
    expect(line.test('Agent C g1mh B: agent proof chromium 04e1e71')).toBe(true);
    expect(line.test('Agent C g1mh A#4821: agent proof chromium 04e1e71')).toBe(false);
  });
});
