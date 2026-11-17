// meta SHARD-SOURCE SS-JP2 (F18): every placed upload the build lacks gets a Shard Select card. Staging places six uploads after
// v0.1.34's build; a four-lookup cap left the fifth and sixth (Glowfen) with no card and a COMING SOON zone page.
import { expect, test } from 'vitest';
import { CARD_PARALLEL, catalogueCards } from '../src/client/game/grid/placedCards';

const SLUGS = ['brasscap-mesa', 'mu9-test-upload', 'mossgate', 'mirror-salt', 'glowfen', 'cinder-springs', 'kitewind-terraces'] as const;
const named = (slug: string): string => slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

/** A catalogue that answers every slug after `ms`, and counts how many asks are open at once. */
function catalogue(ms = 5): { fetch: typeof fetch; asked: string[]; most: () => number } {
  const asked: string[] = [];
  let open = 0, most = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const slug = decodeURIComponent(String(input instanceof Request ? input.url : input).split('/').pop() ?? '');
    asked.push(slug); open += 1; most = Math.max(most, open);
    // as a browser's fetch: an abort rejects it at once
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); });
      });
    } finally { open -= 1; }
    return new Response(JSON.stringify({ slug, name: named(slug) }));
  };
  return { fetch, asked, most: () => most };
}

test('SS-JP2: a placement with seven unknown slugs cards all seven, in the order placed', async () => {
  const api = catalogue();
  const rows = await catalogueCards(SLUGS, { fetch: api.fetch, api: 'https://api.test', signal: new AbortController().signal, order: 20 });
  expect(rows.map(({ slug, name, order }) => ({ slug, name, order }))).toEqual(SLUGS.map((slug, n) => ({ slug, name: named(slug), order: 20 + n })));
  expect([...api.asked].sort()).toEqual([...SLUGS].sort());
});

test('SS-JP2: the lookups run at most CARD_PARALLEL at a time, and a slug asked twice is asked once', async () => {
  const api = catalogue(), many = Array.from({ length: 20 }, (_, n) => `upload-${String(n)}`);
  const rows = await catalogueCards([...many, ...many], { fetch: api.fetch, api: 'https://api.test', signal: new AbortController().signal, order: 1 });
  expect(rows).toHaveLength(20);
  expect(api.asked).toHaveLength(20);
  expect(api.most()).toBe(CARD_PARALLEL);
});

test('SS-JP2: the deadline still holds: lookups past it give no row, and those answered before it keep theirs', async () => {
  const fast = catalogue(1), slow = catalogue(400);
  const fetch: typeof globalThis.fetch = (input, init) => (String(input).endsWith('/glowfen') ? slow.fetch : fast.fetch)(input, init);
  const rows = await catalogueCards(SLUGS, { fetch, api: 'https://api.test', signal: new AbortController().signal, order: 1, deadlineMs: 100 });
  expect(rows.map(row => row.slug)).toEqual(SLUGS.filter(slug => slug !== 'glowfen'));
});
