// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real local HTTP receiver.
import {createServer} from 'node:http';
import {describe, expect, it, vi} from 'vitest';
import {uploadActivator, uploadActivationReceiver, type UploadActivationPorts} from '../src/server/host/dedicated/uploadActivation';
import {ACTIVATION_GIVE_UP_MS, ACTIVATION_RETRY_MS, activationDelivery, gameActivationClient, type CookApi, type ActivationNotice} from '../src/cook/game/uploadTransport';
import type {UploadActivation} from '../src/shared/game/shardfile/uploadActivation';
import type {PlacementFile} from '../src/shared/game/grid/placementRows';

const token = ['fixture', 'game', 'activation', 'test', 'key', '32', 'bytes'].join('-');
const notice: UploadActivation = {uploadId: '11111111-1111-1111-1111-111111111111', hash: 'a'.repeat(64), slug: 'activation-fixture', channel: 'staging'};
const published: ActivationNotice = {...notice, channels: ['staging']};
const placed: PlacementFile = {kind: 'placement', channel: 'staging', serial: 1, cells: [{slug: notice.slug, instance: notice.slug, cell: [1, 1], hash: notice.hash}]};
const ports = (overrides: Partial<UploadActivationPorts> = {}): UploadActivationPorts => ({channel: 'staging', build: 'b1', read: () => Promise.resolve(placed), preload: () => Promise.resolve(undefined), place: () => undefined, open: cells => Promise.resolve(cells), opened: () => true, ...overrides});

describe('the real game activation gate', () => {
  it('preloads exact bytes before placing and waits for actual opening', async () => {
    const order: string[] = [];
    const activate = uploadActivator(ports({preload: (slug, hash) => {expect({slug, hash}).toEqual({slug: notice.slug, hash: notice.hash}); order.push('pack'); return Promise.resolve(undefined);}, place: () => {order.push('place');}, open: cells => {order.push('open'); return Promise.resolve(cells);}}));
    expect(await activate(notice)).toEqual({...notice, build: 'b1', preloaded: true, instances: [notice.slug]});
    expect(order).toEqual(['pack', 'place', 'open']);
  });

  it.each(['wrong-channel', 'old-hash', 'missing-placement', 'bad-pack', 'not-open'] as const)('withholds acknowledgement for %s', async cause => {
    const options = ports();
    const overrides: Partial<UploadActivationPorts> = cause === 'wrong-channel' ? {channel: 'production'}
      : cause === 'old-hash' ? {read: () => Promise.resolve({...placed, cells: placed.cells.map(row => ({...row, hash: 'b'.repeat(64)}))})}
        : cause === 'missing-placement' ? {read: () => Promise.resolve({...placed, cells: []})}
          : cause === 'bad-pack' ? {preload: () => Promise.reject(new Error('bad pack'))} : {opened: () => false};
    await expect(uploadActivator({...options, ...overrides})(notice)).rejects.toThrow();
  });

  it('honours a recorded placement opt-out only after exact pack preload', async () => {
    const preload = vi.fn(() => Promise.resolve(undefined));
    const activate = uploadActivator(ports({read: () => Promise.resolve({...placed, cells: []}), preload}));
    await expect(activate(notice)).rejects.toThrow('does not publish');
    expect(await activate({...notice, place: false})).toMatchObject({preloaded: true, instances: [], place: false});
    expect(preload).toHaveBeenCalledWith(notice.slug, notice.hash);
  });

  // 2026-11-19: staging's file (serial 46) named seven API-placed cells; 21 uploads of catalogue slugs waited on a row it never writes.
  it('activates an upload of a catalogue slug on its own cell, which the signed file never names', async () => {
    const placedRows: unknown[] = [], own = {slug: '_activation-fixture', instance: 'fixture-cell', cell: [0, 1] as const};
    const activate = uploadActivator(ports({read: () => Promise.resolve({...placed, cells: []}), place: row => {placedRows.push(row);},
      catalogue: slug => slug === notice.slug ? own : undefined}));
    expect(await activate(notice)).toMatchObject({preloaded: true, instances: ['fixture-cell']});
    expect(placedRows).toEqual([{...own, hash: notice.hash}]);
    await expect(activate({...notice, slug: 'nobody'})).rejects.toThrow('does not publish');
  });

  it('does not believe an older signed placement after a newer one', async () => {
    let serial = 4;
    const activate = uploadActivator(ports({read: () => Promise.resolve({...placed, serial})}));
    await activate(notice); serial = 3;
    await expect(activate(notice)).rejects.toThrow('Stale activation');
  });

  it('requires real authenticated local game HTTP acknowledgement and heals a lost API ACK', async () => {
    let ready = false, acknowledgements = 0;
    const activate = uploadActivator(ports({opened: () => ready})), receiver = uploadActivationReceiver(token, activate);
    const server = createServer((request, response) => {if (!receiver(request, response)) response.writeHead(404).end();});
    await new Promise<void>(resolve => {server.listen(0, '127.0.0.1', resolve);});
    const address = server.address(); if (address === null || typeof address === 'string') throw new Error('Missing receiver');
    const url = `http://127.0.0.1:${address.port}`;
    const acknowledge = vi.fn(() => {acknowledgements++; return acknowledgements === 1 ? Promise.reject(new Error('lost response')) : Promise.resolve();});
    const api: CookApi = {pending: async function* pending() {}, activations: async function* activations() {yield published;}, download: () => Promise.resolve(new Uint8Array()), verdict: () => Promise.resolve(), acknowledge};
    const lines: string[] = [], delivery = activationDelivery(api, gameActivationClient({staging: {url, token}}, 'b1'), line => {lines.push(line);});
    try {
      await expect(gameActivationClient({staging: {url, token: 'wrong'}}, 'b1').activate(published, 'staging')).rejects.toThrow('401');
      await delivery.sweep(); await delivery.idle(); expect(acknowledge).not.toHaveBeenCalled();
      // 2026-11-19: staging's cook logged a bare "waiting" for 22 uploads over 14 h; the line names the game's reason.
      expect(lines).toEqual([`upload ${notice.uploadId}: game acknowledgement waiting: Game activation answered 503: Upload placement has not opened`]);
      ready = true;
      await delivery.sweep(); await delivery.idle(); expect(acknowledge).toHaveBeenCalledTimes(1);
      await delivery.sweep(); await delivery.idle(); expect(acknowledge).toHaveBeenCalledTimes(2);
      expect(acknowledge).toHaveBeenLastCalledWith(published, ['staging']);
      await expect(gameActivationClient({staging: {url, token}}, 'other-build').activate(published, 'staging')).rejects.toThrow('another activation');
    } finally {await new Promise<void>(resolve => {server.close(() => {resolve();});});}
  });

  it('names a channel the cook has no receiver for', async () => {
    const lines: string[] = [], acknowledge = vi.fn(() => Promise.resolve());
    const api: CookApi = {pending: async function* pending() {}, activations: async function* activations() {yield {...published, channels: ['staging', 'production']};}, download: () => Promise.resolve(new Uint8Array()), verdict: () => Promise.resolve(), acknowledge};
    const read: typeof fetch = () => Promise.resolve(Response.json({...notice, build: 'b1', preloaded: true, instances: [notice.slug]}));
    const delivery = activationDelivery(api, gameActivationClient({staging: {url: 'http://127.0.0.1:8791', token}}, 'b1', read), line => {lines.push(line);});
    await delivery.sweep(); await delivery.idle();
    expect(acknowledge).not.toHaveBeenCalled();
    expect(lines).toEqual([`upload ${notice.uploadId}: game acknowledgement waiting: production: No local game receiver for activation`]);
  });

  // QA 11-24 row 63: two unplaced open plots' uploads logged the same refusal every 45 s for two days and nothing alarmed.
  it('backs a never-acknowledged upload off to hourly and alarms once a day instead of retrying every sweep', async () => {
    let clock = 0, listed = true, calls = 0;
    const lines: string[] = [], alarms: string[] = [], acknowledge = vi.fn(() => Promise.resolve());
    const api: CookApi = {pending: async function* pending() {}, activations: async function* activations() {if (listed) yield published;}, download: () => Promise.resolve(new Uint8Array()), verdict: () => Promise.resolve(), acknowledge};
    const read: typeof fetch = () => {calls++; return Promise.resolve(Response.json({reason: 'Placement does not publish the upload hash'}, {status: 503}));};
    const delivery = activationDelivery(api, gameActivationClient({staging: {url: 'http://127.0.0.1:8791', token}}, 'b1', read), line => {lines.push(line);}, {now: () => clock, alarm: line => {alarms.push(line);}});
    const sweep = async (at: number): Promise<void> => {clock = at; await delivery.sweep(); await delivery.idle();};
    for (let at = 0; at < ACTIVATION_GIVE_UP_MS; at += 45_000) await sweep(at);
    expect(lines.every(line => line.endsWith('game acknowledgement waiting: Game activation answered 503: Placement does not publish the upload hash'))).toBe(true);
    expect(alarms).toEqual([]);
    const before = calls;
    await sweep(ACTIVATION_GIVE_UP_MS);
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toMatch(/ALARM game acknowledgement refused for 60 min \(activation-fixture a{12}\): Game activation answered 503: Placement does not publish/u);
    // The next hour's sweeps neither call the game nor log.
    const quiet = lines.length;
    for (let at = ACTIVATION_GIVE_UP_MS + 45_000; at < ACTIVATION_GIVE_UP_MS + ACTIVATION_RETRY_MS; at += 45_000) await sweep(at);
    expect(calls).toBe(before + 1); expect(lines).toHaveLength(quiet);
    // Hourly retries stay quiet until a day has passed since the alarm.
    for (let hour = 1; hour < 24; hour++) await sweep(ACTIVATION_GIVE_UP_MS + hour * ACTIVATION_RETRY_MS);
    expect(alarms).toHaveLength(1); expect(calls).toBe(before + 24);
    await sweep(ACTIVATION_GIVE_UP_MS + 24 * ACTIVATION_RETRY_MS);
    expect(alarms).toHaveLength(2);
    // Once the API stops listing it (acknowledged or superseded), a later notice starts its own clock.
    listed = false; await sweep(clock + 1);
    listed = true; const fresh = lines.length; await sweep(clock + 1);
    expect(lines.slice(fresh)).toEqual([`upload ${notice.uploadId}: game acknowledgement waiting: Game activation answered 503: Placement does not publish the upload hash`]);
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('does not report live for a cook enqueue response or wrong identity', async () => {
    const read: typeof fetch = () => Promise.resolve(Response.json({queued: notice.hash}, {status: 202}));
    await expect(gameActivationClient({staging: {url: 'http://127.0.0.1:8791', token}}, 'b1', read).activate(published, 'staging')).rejects.toThrow('202');
    const wrong: typeof fetch = () => Promise.resolve(Response.json({...notice, hash: 'b'.repeat(64), build: 'b1', preloaded: true, instances: [notice.slug]}));
    await expect(gameActivationClient({staging: {url: 'http://127.0.0.1:8791', token}}, 'b1', wrong).activate(published, 'staging')).rejects.toThrow('another activation');
    await expect(gameActivationClient({staging: {url: 'https://external.example', token}}, 'b1', read).activate(published, 'staging')).rejects.toThrow('loopback');
  });

  // ONE-FORMAT OF18c: a plain upload to production may not hand the page's objects to the window.
  const debugPlan = {clientPlan: {features: [{kind: 'debug.expose', name: 'fixture.debug'}, {kind: 'world.scenes'}]}};
  const onProduction = {channel: 'production', read: () => Promise.resolve({...placed, channel: 'production' as const})};
  it('refuses a production upload whose client plan exposes debug objects, by name, before placing it', async () => {
    const place = vi.fn();
    const activate = uploadActivator(ports({...onProduction, preload: () => Promise.resolve(debugPlan), place}));
    await expect(activate({...notice, channel: 'production'})).rejects.toThrow('debug.expose is refused on production: fixture.debug');
    expect(place).not.toHaveBeenCalled();
  });

  it('places the same upload on staging, and a production upload without debug.expose', async () => {
    await expect(uploadActivator(ports({preload: () => Promise.resolve(debugPlan)}))(notice)).resolves.toMatchObject({preloaded: true});
    const plain = uploadActivator(ports({...onProduction, preload: () => Promise.resolve({clientPlan: {features: [{kind: 'world.scenes'}]}})}));
    await expect(plain({...notice, channel: 'production'})).resolves.toMatchObject({preloaded: true});
  });
});
