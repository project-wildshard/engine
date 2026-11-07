import {SHAPE_BYTES} from './fixtures/nalatiShapes';
import { expect, test } from 'vitest';
import { Bone, BufferGeometry, Group, Object3D } from 'three';
import { mountedSpecimens, type MountedSpecimenPorts } from '../src/client/game/models/mountedSpecimen';
import { Scope } from '../src/shared/engine/app/scope';
import { MOUNTED_FIGURE } from './fixtures/nalati-poi-paint-original';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import type { ModelContext } from '../src/client/engine/models/model';
import type { Rng } from '../src/shared/engine/core/rng';
import { installWorldFixture } from './fixtures/worldSetup';

await installWorldFixture();

const row = { model: { id: 'fixture/rider', name: 'A rider', category: 'people', pipeline: ['code'], file: 'test/mounted-specimen-factory.test.ts', defaults: {} },
  slug: 'fixture', json: 'riding/seat.json', species: 'pony', variant: 'grey', tint: 0.25 };
const card = new Scope('fixture.card'), ctx = legacyDouble<ModelContext>({ specimenScope: card }), rng = legacyDouble<Rng>({}), seated = new BufferGeometry();
const define = (input: unknown, fixture: MountedSpecimenPorts): ReturnType<ReturnType<typeof mountedSpecimens>> => mountedSpecimens(fixture)(input);
/** the factory's ports, each call recorded */
function ports(file: unknown, bones: Record<string, Object3D>): { ports: MountedSpecimenPorts; calls: string[] } {
  const calls: string[] = [];
  return { calls, ports: {
    product: slug => { calls.push(`product ${slug}`); return Promise.resolve({json:name=>{calls.push(`json ${name}`);return Promise.resolve(file);},file:name=>{const bytes=SHAPE_BYTES.get(name);if(bytes===undefined)throw new Error('Missing fixture raw shape');return Promise.resolve(bytes);}}); },
    rig: (_ctx, species, variant, tint) => { calls.push(`rig ${species}/${variant} ${tint}`); return { bones, mesh: new Group() }; },
    figure: (rows, own) => { calls.push(`figure ${rows.mount}`); own(seated); const root = new Object3D(); root.name = 'seated'; return { root }; },
  } };
}

test('a mounted specimen admits only plain rows, and refuses before any read', () => {
  const { ports: fixture, calls } = ports(MOUNTED_FIGURE, {});
  for (const tint of ['warm', -0.1, 1.5, Number.NaN]) expect(() => define({ ...row, tint }, fixture)).toThrow();
  expect(() => define({ ...row, extra: 'field' }, fixture)).toThrow();
  const { tint: _tint, ...untinted } = row; expect(() => define({ ...untinted, scale: 0.5 }, fixture)).toThrow();
  const cycle: Record<string, unknown> = { ...row }; cycle['self'] = cycle;
  expect(() => define(cycle, fixture)).toThrow();
  expect(() => define(Object.defineProperty({ ...row }, 'json', { enumerable: true, get: () => { throw new Error('read'); } }), fixture)).toThrow();
  expect(calls).toEqual([]);
});

test('a mounted specimen admits its seat file again and seats the figure on the declared joint of its rig', async () => {
  const seat = new Bone(), { ports: fixture, calls } = ports(MOUNTED_FIGURE, { tail: new Bone(), [MOUNTED_FIGURE.mount]: seat });
  const specimen = define(row, fixture);
  expect(() => specimen.build(ctx, {}, rng)).toThrow('not prepared');
  await specimen.prepare?.();
  const body = specimen.build(ctx, {}, rng);
  expect(calls).toEqual(['product fixture', 'json riding/seat.json', 'rig pony/grey 0.25', `figure ${MOUNTED_FIGURE.mount}`]);
  expect(body).toBeInstanceOf(Group); expect(seat.children.map(child => child.name)).toEqual(['seated']);
  // the figure's decoded resources belong to the specimen card's owner
  expect(card.owns(seated)).toBe(true);
  // a named seat file that refuses its rows never reaches a build
  for (const file of [{ ...MOUNTED_FIGURE, mount: '' }, { ...MOUNTED_FIGURE, extra: 'field' }]) {
    const refused = ports(file, { [MOUNTED_FIGURE.mount]: new Bone() }), named = define(row, refused.ports);
    await expect(named.prepare?.()).rejects.toThrow();
    expect(() => named.build(ctx, {}, rng)).toThrow('not prepared'); expect(refused.calls).toEqual(['product fixture', 'json riding/seat.json']);
  }
  // a rig without the seat's joint refuses before the figure is made
  const bare = ports(MOUNTED_FIGURE, { tail: new Bone() }), riderless = define(row, bare.ports);
  await riderless.prepare?.();
  expect(() => riderless.build(ctx, {}, rng)).toThrow('no seat joint');
  expect(bare.calls.some(call => call.startsWith('figure'))).toBe(false);
});
