import {expect, test} from 'vitest';
import {boundedResponse} from './product';

function response(status: number): Response {
  const value = new Response(new Uint8Array([1, 2, 3]), {status});
  Object.defineProperty(value, 'url', {value: 'https://example.test/assets/pickup.bin?token=private'});
  return value;
}

test('unavailable asset refusal retains its path, HTTP status and declared cap', async () => {
  const pending = boundedResponse(response(404), 3);
  await expect(pending).rejects.toThrow('Unavailable or oversized shardfile asset: /assets/pickup.bin (HTTP 404, cap 3 B)');
  await expect(pending).rejects.not.toThrow('private');
});

test.each([-1, 1.5, Number.NaN, Infinity, 25_000_001])('invalid cap %s still refuses successful HTTP responses', async maximum => {
  await expect(boundedResponse(response(200), maximum)).rejects.toThrow(
    `Unavailable or oversized shardfile asset: /assets/pickup.bin (HTTP 200, cap ${maximum} B)`,
  );
});

test('responses without a URL retain explicit status and cap context', async () => {
  await expect(boundedResponse(new Response(null, {status: 503}), 0)).rejects.toThrow(
    'Unavailable or oversized shardfile asset: asset bytes (HTTP 503, cap 0 B)',
  );
});

test('exact bounded bytes and both wire-size refusal paths stay unchanged', async () => {
  const reads: number[] = [];
  expect(await boundedResponse(response(200), 3, bytes => { reads.push(bytes); })).toEqual(new Uint8Array([1, 2, 3]));
  expect(reads).toEqual([3]);
  await expect(boundedResponse(response(200), 2)).rejects.toThrow('Shardfile wire size exceeds cap');
  await expect(boundedResponse(new Response(new Uint8Array([1, 2, 3]), {headers: {'content-length': '3'}}), 2))
    .rejects.toThrow('Shardfile wire size exceeds cap');
});
