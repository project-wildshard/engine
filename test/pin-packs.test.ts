// Meta QA 11-25 row 64: Pine r18 and Driftwood r13 moved on staging after v0.1.91's cut with no packs for that build and read
// REV-BEHIND. A pin of a head with no packs for one build the channel serves waits for the cook, then refuses, naming it.
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {headPackGaps, waitForHeadPacks} from '../scripts/pin-packs.mjs';

const HASH = 'a'.repeat(64), OLD = '1'.repeat(40), NEW = '2'.repeat(40);
/** A pack store that has the head's index for `cooked` builds only; it records each read. */
const store = (cooked: Set<string>, seen: string[] = []) => (url: string | URL, init?: RequestInit) => {
  const text = String(url);
  seen.push(`${text} ${new Headers(init?.headers).get('Origin') ?? ''}`);
  const build = /\/index\/([0-9a-f]{40})\//u.exec(text)?.[1] ?? '';
  return Promise.resolve(new Response(cooked.has(build) ? '{}' : 'missing', {status: cooked.has(build) ? 200 : 404}));
};

describe('a pin waits for packs on every build its channel serves (QA 11-25 row 64)', () => {
  it('names each served build with no index for the head, read with the channel page\'s Origin', async () => {
    const seen: string[] = [];
    expect(await headPackGaps(HASH, [OLD, NEW], 'https://staging.wildshard.io', store(new Set([OLD]), seen))).toEqual([`${NEW} 404`]);
    expect(seen).toContain(`https://packs.wildshard.io/index/${NEW}/${HASH}.json https://staging.wildshard.io`);
  });

  it('refuses a head missing one served build\'s pack after its wait, naming the build', async () => {
    let clock = 0;
    const lines: string[] = [];
    await expect(waitForHeadPacks({slug: 'pine-hollow', hash: HASH, channel: 'prod', log: line => { lines.push(line); },
      read: store(new Set([OLD])), builds: () => Promise.resolve([OLD, NEW]),
      sleep: ms => { clock += ms; return Promise.resolve(); }, now: () => clock, limitMs: 3 * 60_000})).rejects.toThrow(
      new RegExp(`^pin refused: pine-hollow aaaaaaaa has no packs for 1 build\\(s\\) prod serves after 3 min: ${NEW} 404\\.`, 'u'));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain(`no packs yet for ${NEW} 404`);
  });

  it('pins once the cook writes the missing build\'s index, and reads the served builds again each pass', async () => {
    let clock = 0, passes = 0;
    const cooked = new Set([OLD]), lines: string[] = [];
    await waitForHeadPacks({slug: 'driftwood-isle', hash: HASH, channel: 'staging', log: line => { lines.push(line); }, read: store(cooked),
      builds: () => { passes++; return Promise.resolve([OLD, NEW]); },
      sleep: ms => { clock += ms; cooked.add(NEW); return Promise.resolve(); }, now: () => clock});
    expect(passes).toBe(2);
    expect(lines.at(-1)).toMatch(/^PASS driftwood-isle aaaaaaaa has packs for every build staging serves/u);
  });

  it('shard-pin checks the packs before it moves the pin', () => {
    const flow = readFileSync('.github/workflows/shard-pin.yml', 'utf8');
    const check = flow.indexOf('run: node scripts/pin-packs.mjs "$SLUG" "$HASH" "$CHANNEL" --wait=40');
    expect(check).toBeGreaterThan(0);
    expect(flow.indexOf('run: node scripts/pin-shard.ts', check)).toBeGreaterThan(check);
  });
});
