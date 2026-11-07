// oxlint-disable-next-line import/no-nodejs-modules -- Independently hash the exact original member bytes.
import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { prepareBinarySources } from '../src/client/game/models/binarySource';

const first = new Uint8Array([1, 2]), second = new Uint8Array([3, 4, 5]);
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const bank = { file: 'bank', bytes: 5, members: [
  { file: 'first', offset: 0, bytes: 2, sha256: hash(first) },
  { file: 'second', offset: 2, bytes: 3, sha256: hash(second) },
] };
const requests = [{ source: { file: 'second' }, bytes: 3 }, { source: { file: 'first' }, bytes: 2 }];
function reader(body = new Uint8Array([1, 2, 3, 4, 5])) {
  const file = vi.fn((name: string): Promise<Uint8Array> => Promise.resolve(name === 'bank' ? body : name === 'first' ? first : second));
  return { file, hasFile: vi.fn((name: string): boolean => ['first', 'second', 'bank'].includes(name)) };
}

test('one bank restores exact independent members in the original request order', async () => {
  const product = reader();
  const result = await prepareBinarySources(product, requests, undefined, [bank]);
  expect(product.file.mock.calls).toEqual([['bank']]);
  expect([...result.keys()]).toEqual(['second', 'first']);
  expect(result.get('first')).toEqual(first);
  expect(result.get('second')).toEqual(second);
  const bytes = result.get('first');
  if (bytes === undefined) throw new Error('Missing admitted member');
  bytes[0] = 99;
  expect(first[0]).toBe(1);
  expect(result.get('second')).toEqual(second);
});

test('partial demand reads only its original file and never an unrequested member', async () => {
  const product = reader();
  const result = await prepareBinarySources(product, [requests[1]], undefined, [bank]);
  expect(product.file.mock.calls).toEqual([['first']]);
  expect([...result.keys()]).toEqual(['first']);
});

test('bad bank metadata refuses before reading product capabilities', async () => {
  let capabilities = 0;
  const file = vi.fn(() => Promise.resolve(first));
  const product = { get file() { capabilities++; return file; } };
  const a = bank.members[0], b = bank.members[1];
  if (a === undefined || b === undefined) throw new Error('Missing fixture members');
  for (const banks of [
    [bank, bank], [{ ...bank, members: [a, a] }], [{ ...bank, members: [a, { ...b, offset: 1 }] }],
    [{ ...bank, bytes: 6 }], [{ ...bank, members: [{ ...a, sha256: 'bad' }, b] }],
    [{ ...bank, members: [{ ...a, file: 'bank' }, b] }], [{ ...bank, callback: () => undefined }],
  ]) await expect(prepareBinarySources(product, requests, undefined, banks)).rejects.toThrow();
  await expect(prepareBinarySources(product, [{ source: { file: 'first' }, bytes: 9 }], undefined, [bank]))
    .rejects.toThrow('Binary bank member length differs');
  expect(capabilities).toBe(0);
  expect(file).not.toHaveBeenCalled();
});

test('all original and transport file admissions precede any IO', async () => {
  const product = reader();
  product.hasFile.mockImplementation(name => name !== 'second');
  await expect(prepareBinarySources(product, requests, undefined, [bank])).rejects.toThrow('Missing binary source second');
  expect(product.file).not.toHaveBeenCalled();
  product.hasFile.mockImplementation(name => name !== 'bank');
  await expect(prepareBinarySources(product, requests, undefined, [bank])).rejects.toThrow('Missing binary source bank');
  expect(product.file).not.toHaveBeenCalled();
});

test('truncated and corrupt bank bytes refuse without falling back to member IO', async () => {
  for (const body of [new Uint8Array(4), new Uint8Array([1, 2, 3, 4, 99])]) {
    const product = reader(body);
    await expect(prepareBinarySources(product, requests, undefined, [bank])).rejects.toThrow();
    expect(product.file.mock.calls).toEqual([['bank']]);
  }
});

test('retired scopes and changed readers cannot publish bank members', async () => {
  const scope = new Scope('binary-bank');
  const product = reader();
  product.file.mockImplementation(() => { scope.dispose(); return Promise.resolve(new Uint8Array([1, 2, 3, 4, 5])); });
  await expect(prepareBinarySources(product, requests, scope, [bank])).rejects.toThrow('Binary source owner retired');
  const changed = reader();
  changed.file.mockImplementation(() => {
    changed.hasFile = vi.fn(() => true);
    return Promise.resolve(new Uint8Array([1, 2, 3, 4, 5]));
  });
  await expect(prepareBinarySources(changed, requests, undefined, [bank])).rejects.toThrow('Binary source reader changed');
});
