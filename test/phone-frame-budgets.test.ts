import { describe, expect, test } from 'vitest';
import { failed, judgeAll, recordAll } from '../src/scripts/budgets/cli.mjs';
import { readCaps } from '../src/scripts/budgets/files.mjs';
import { budgetReport, budgetResultLine, parseBudgetResults } from '../src/scripts/budgets/watch.mjs';
import { FRAME_MS, PHONE_LOW, expectPinnedZones, phoneFrameMeasures, readPhoneFrames, slowFrame } from '../src/scripts/budgets/phone-frames.mjs';

const slug = 'driftwood-isle', key = `render/phone-low/triangles/${slug}`;
const pin = (revision: number) => ({ [slug]: `${slug}@${revision}` });
const reading = (triangles = 100) => ({
  slug, tier: 'phone', low: true, deviceDpr: PHONE_LOW.deviceDpr, renderDpr: PHONE_LOW.renderDpr,
  views: [0, 1, 2].map(view => [0, 1, 2].map(sample => ({
    frame: 1 + view * 3 + sample,
    triangles: triangles + view * 10 + sample,
    draws: 30 - view * 2 + sample, programs: 50 + view + sample,
  }))),
});

describe('phone Low frame budgets', () => {
  test('measures the heaviest fixed view per counter and names the pin revision', () => {
    expect(phoneFrameMeasures(pin(5), [reading()], '602f0d93')).toEqual({
      commit: '602f0d93', measures: {
        [key]: { value: 121, contentKey: 'driftwood-isle@5' },
        [`render/phone-low/draws/${slug}`]: { value: 31, contentKey: 'driftwood-isle@5' },
        [`render/phone-low/programs/${slug}`]: { value: 53, contentKey: 'driftwood-isle@5' },
      },
    });
  });

  test('refuses a missing, extra or duplicated pin', () => {
    expect(() => phoneFrameMeasures({ ...pin(5), 'pine-hollow': 'pine-hollow@6' }, [reading()])).toThrow('every pinned zone');
    expect(() => expectPinnedZones(pin(5), [slug, 'pine-hollow'])).toThrow('every pinned zone');
    expect(() => phoneFrameMeasures(pin(5), [reading(), reading()])).toThrow('every pinned zone');
  });

  test.each([
    { tier: 'desktop' }, { low: false }, { renderDpr: 2 }, { deviceDpr: 1 },
  ])('refuses the wrong renderer proof %j', proof => {
    expect(() => phoneFrameMeasures(pin(5), [{ ...reading(), ...proof }])).toThrow('expected phone Low');
  });

  test('refuses a repeated frame or absent program count', () => {
    const repeated = reading();
    repeated.views[2]![0]!.frame = repeated.views[1]![2]!.frame;
    expect(() => phoneFrameMeasures(pin(5), [repeated])).toThrow('incomplete renderer frame samples');
    const missing = reading();
    missing.views[0]![0]!.programs = 0;
    expect(() => phoneFrameMeasures(pin(5), [missing])).toThrow('incomplete renderer frame samples');
  });

  test('J444 flags exactly 10% on the same revision and records a new revision', () => {
    const caps = readCaps();
    const first = recordAll(caps, { schema: 1, about: 'Phone Low test baselines', baselines: {} }, phoneFrameMeasures(pin(5), [reading(79)]));
    expect(first.errors).toEqual([]);
    const baseline = first.baselines;
    const judge = (revision: number, triangles: number) => judgeAll(caps, baseline, phoneFrameMeasures(pin(revision), [reading(triangles)]));
    expect(judge(5, 88).find(row => row.key === key)?.status).toBe('ok');
    expect(judge(5, 89).find(row => row.key === key)).toMatchObject({ status: 'regressed', value: 110, baseline: 100, line: 110, hard: null });
    expect(failed(judge(5, 89))).toBe(true);
    const failure = judge(5, 89).find(row => row.key === key)!;
    const report = budgetReport({ id: 7, head_sha: '602f0d93', created_at: '', conclusion: 'failure' },
      parseBudgetResults(budgetResultLine(failure)), ['lane']);
    expect(report.lines[0]).toContain('110 triangles, line 110 triangles');
    expect(judge(6, 89).find(row => row.key === key)?.status).toBe('raised');
    const next = recordAll(caps, baseline, phoneFrameMeasures(pin(6), [reading(89)]));
    expect(next.baselines.baselines[key]).toEqual({ value: 110, contentKey: 'driftwood-isle@6' });
  });

  // Meta QA-FEEDBACK-2026-11-24 row 57: phone High linked 39 programs after control at Driftwood's dock, and no budget saw it.
  const high = (programs = 100) => ({ ...reading(), graphics: 'high' as const, low: false, renderDpr: 2,
    views: reading().views.map(view => view.map(frame => ({ ...frame, programs: programs + frame.frame }))) });

  test('phone High records its programs beside Low, and Low alone still measures', () => {
    const highKey = `render/phone-high/programs/${slug}`;
    const both = phoneFrameMeasures(pin(5), [reading(), high()]);
    expect(both.measures[highKey]).toEqual({ value: 108, contentKey: 'driftwood-isle@5' });
    expect(Object.keys(both.measures).filter(name => name.startsWith('render/phone-high/'))).toEqual([highKey]);
    expect(both.measures[key]).toEqual({ value: 121, contentKey: 'driftwood-isle@5' });
    expect(phoneFrameMeasures(pin(5), [reading()]).measures[highKey]).toBeUndefined();
  });

  test('refuses a High reading that is Low, or a High sweep missing a pinned zone', () => {
    expect(() => phoneFrameMeasures(pin(5), [reading(), { ...high(), low: true }])).toThrow('expected phone High');
    expect(() => phoneFrameMeasures(pin(5), [reading(), { ...high(), renderDpr: 0 }])).toThrow('expected phone High');
    const pins = { ...pin(5), 'pine-hollow': 'pine-hollow@6' };
    expect(() => phoneFrameMeasures(pins, [reading(), { ...reading(), slug: 'pine-hollow' }, high()])).toThrow('every pinned zone');
  });

  test('J444 judges phone High programs against its own revision', () => {
    const caps = readCaps();
    const highKey = `render/phone-high/programs/${slug}`;
    const first = recordAll(caps, { schema: 1, about: 'Phone High test baselines', baselines: {} }, phoneFrameMeasures(pin(5), [reading(), high(92)]));
    expect(first.errors).toEqual([]);
    expect(first.baselines.baselines[highKey]).toEqual({ value: 100, contentKey: 'driftwood-isle@5' });
    const judge = (programs: number) => judgeAll(caps, first.baselines, phoneFrameMeasures(pin(5), [reading(), high(programs)])).find(row => row.key === highKey);
    expect(judge(101)?.status).toBe('ok');
    expect(judge(102)).toMatchObject({ status: 'regressed', value: 110, line: 110, hard: null });
  });

});

// Meta QA 11-25 row 99: CP17 entered each zone by the title's tap, into its grid cell with neighbours; a grid page runs the
// grid's level (`platform.grid`), so the wait for the zone's level never settled and budgets run 45755470720 timed out every
// capture. J522 (4): a measuring tool enters its zone alone, a one-cell world. This page stand-in boots what a real page
// boots from what it was served: a tap in the tab enters the grid with every cell, else its catalogue's one cell.
describe('phone frames enter a zone alone (J522 (4), QA 11-25 row 99)', () => {
  type Cell = { instance: string; slug: string; cell: number[] };
  const CATALOGUE = { placements: [{ slug: 'brasscap-mesa' }, { slug: 'pine-hollow' }],
    grid: { cells: [{ instance: 'brasscap-mesa', slug: 'brasscap-mesa', cell: [0, 0] }, { instance: 'pine-hollow', slug: 'pine-hollow', cell: [1, 0] }] } };
  const HTML = `<html><head><script type="application/json" id="ws-catalogue">${JSON.stringify(CATALOGUE)}</script></head></html>`;

  function fakeBrowser() {
    const seen = { addresses: [] as string[], served: [] as Cell[][], tapped: false, grants: [] as string[] };
    const session = new Map<string, string>();
    let frame = 0, cells: Cell[] = [], inside = '';
    const game = {
      tier: 'phone', qualityLow: true, frameCount: 0, level: { id: 'platform.grid', spawn: { x: 0, z: 0, yaw: 0 } },
      lastFrame: { triangles: 1000, calls: 20 }, frameGate: () => true, applyQuality() { game.qualityLow = !game.qualityLow; },
      renderer: { info: { programs: [1, 2, 3] }, getPixelRatio: () => (game.qualityLow ? 1 : 2) }, app: { clock: { setCapture() { /* no clock */ } } },
    };
    const shard = { world: { game, hud: { entered: true, paused: false } }, pose: async () => { /* stands still */ },
      shard: { grid: { state: () => ({ inside, cells }) } } };
    const globals = { window: { __wildshard: shard }, document: { querySelector: () => null }, devicePixelRatio: 3,
      sessionStorage: { getItem: (key: string) => session.get(key) ?? null, setItem: (key: string, value: string) => { session.set(key, value); seen.tapped = true; } } };
    /** Run a page function as the page would, one frame later. */
    const inPage = <T,>(fn: (arg: never) => T, arg: unknown): T => {
      game.frameCount = ++frame;
      const held = Object.fromEntries(Object.keys(globals).map(key => [key, Reflect.get(globalThis, key)]));
      for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
      try { return fn(arg as never); } finally { for (const [key, value] of Object.entries(held)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); }
    };
    const routes: { match: string | ((url: URL) => boolean); handler: (route: unknown) => Promise<void> }[] = [];
    let address = 'about:blank';
    const page = {
      on() { /* no page errors */ }, url: () => address, context: () => context,
      async route(match: string | ((url: URL) => boolean), handler: (route: unknown) => Promise<void>) { routes.unshift({ match, handler }); },
      async unroute(match: unknown) { routes.splice(routes.findIndex(row => row.match === match), 1); },
      async goto(url: string) {
        address = url; seen.addresses.push(url);
        if (new URL(url).pathname !== '/') return null;
        let body = HTML;
        const route = routes.find(row => (typeof row.match === 'string' ? row.match === url : row.match(new URL(url))));
        if (route !== undefined) {
          await route.handler({ fetch: async () => ({ text: async () => HTML }), fulfill: async (reply: { body: string }) => { body = reply.body; } });
        }
        const served: Cell[] = JSON.parse(/id="ws-catalogue">([^<]*)</u.exec(body)?.[1] ?? 'null').grid.cells;
        seen.served.push(served);
        const tap = JSON.parse(session.get('wildshard.save.v2@2.session') ?? '{"keys":{}}').keys.titleArrival?.data?.slug as string | undefined;
        // a tap enters the grid with its neighbours; a page with no tap boots its one-cell world (CP10)
        cells = tap === undefined ? served : CATALOGUE.grid.cells;
        inside = (tap === undefined ? served[0] : cells.find(row => row.slug === tap))?.instance ?? '';
        return null;
      },
      evaluate: async (fn: (arg: never) => unknown, arg?: unknown) => inPage(fn, arg),
      async waitForFunction(fn: (arg: never) => unknown, arg: unknown) {
        for (let poll = 0; poll < 20; poll++) {
          const value = inPage(fn, arg);
          if (value) return { jsonValue: async () => value, dispose: async () => { /* nothing held */ } };
        }
        throw new Error('page.waitForFunction: never settled (the 235 s timeout of budgets run 45755470720)');
      },
    };
    // QA 11-26 row 80: enterZone grants the routed one-cell page's origin loopback leave before it routes it
    const context = { addInitScript: async () => { /* fixtures */ }, newPage: async () => page, close: async () => { /* closed */ },
      async grantPermissions(permissions: string[], { origin }: { origin: string }) { seen.grants.push(`${permissions.join(',')} ${origin}`); } };
    return { seen, browser: { newContext: async () => context } as unknown as Parameters<typeof readPhoneFrames>[0] };
  }

  test.each(['pine-hollow', 'glowfen'])('%s: a one-cell world of the zone, no tap, no zone in the address, and it settles', async slug => {
    const { seen, browser } = fakeBrowser();
    const reading = await readPhoneFrames(browser, 'http://127.0.0.1:4401/', slug, 'low');
    expect(reading).toMatchObject({ slug, tier: 'phone', low: true, deviceDpr: 3, renderDpr: 1 });
    expect(reading.views).toHaveLength(3);
    // glowfen has no cell in the build (meta MZ26), so it is seated at the origin
    expect(seen.served).toEqual([[{ instance: slug, slug, cell: [0, 0] }]]);
    expect(seen.tapped).toBe(false);
    expect(seen.grants).toEqual(['local-network-access http://127.0.0.1:4401']);
    expect(seen.addresses.every(url => new URL(url).pathname === '/' && !url.includes(slug))).toBe(true);
  });
});

// Meta QA 11-25 row 55: Nine r11's frames passed the old 30 s guard on CI and failed the sweep with no budget result.
test('a slow frame warns at half the frame guard, long before the guard fails the sweep', () => {
  expect(FRAME_MS).toBeGreaterThanOrEqual(120_000);
  expect(slowFrame('nine-dragon-stack', 'phone High', 30_000)).toBeUndefined();
  expect(slowFrame('nine-dragon-stack', 'phone High', FRAME_MS / 2 + 1)).toMatch(/^::warning::nine-dragon-stack phone High: a frame took 90\.0 s of the 180 s frame guard/u);
});
