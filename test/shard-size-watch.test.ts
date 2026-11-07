import {expect, test} from 'vitest';
import {bookBytes, sizeFindings} from '../scripts/shard-size-watch.mjs';

const quiet = {flow: 'pine-hollow:phone', title: 2_700_000, entry: 110_000_000, book: 111_000_000, stoppedOn: 'network idle'};

test('a title under 3 MB and a flow within 10 % of its book file nothing', () => {
  expect(sizeFindings([quiet])).toEqual([]);
  expect(sizeFindings([{...quiet, entry: 122_100_000}])).toEqual([]);
});

test('a title over 3 MB or a flow past its book by 10 % files a line each', () => {
  expect(sizeFindings([{...quiet, title: 28_500_000}])).toEqual(['pine-hollow:phone: title 28.5 MB, past 3.0 MB']);
  expect(sizeFindings([{...quiet, flow: 'pine-hollow:desktop', entry: 340_500_000, book: 113_000_000}]))
    .toEqual(['pine-hollow:desktop: entry 340.5 MB on the wire against a book of 113.0 MB']);
});

test('a night with no reading is a finding, never a pass', () => {
  expect(sizeFindings([{...quiet, stoppedOn: 'timeout'}])).toEqual(['pine-hollow:phone: the meter stopped on timeout, so this night has no reading']);
  expect(sizeFindings([{...quiet, book: undefined}])).toEqual(['pine-hollow:phone: the packs book has no row']);
});

test('the book answers a shard by client tier and the grid by its Developer mode', () => {
  const book = {client: {'pine-hollow': {phone: {wireBytes: 1}}}, grid: {'000': {'driftwood-isle': {phone: {wireBytes: 2}}}, '100': {'driftwood-isle': {phone: {wireBytes: 3}}}}};
  expect(bookBytes(book, 'pine-hollow', 'phone')).toBe(1);
  expect(bookBytes(book, 'grid', 'phone')).toBe(3);
  expect(bookBytes(book, 'nine-dragon-stack', 'phone')).toBeUndefined();
});
