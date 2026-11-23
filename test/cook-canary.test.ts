// SHARD-COMPAT SP1b3: the canary gate compares what the preparation decides (fence, packs, program rows), never the
// recording's own labels (build, renderer, inputHash, mounts).
import {expect, test} from 'vitest';
import {readCookData, type CookData} from '@wildshard/format/cookData';
import {readTar} from '@wildshard/format/tar';
import {canaryLine, canaryOpens, canaryVerdict} from '../src/cook/game/cookCanary';
import {json, legacyBrasscap, MOVED, PREPARED, prepared} from './fixtures/stale-preparation';

const brasscap = readTar(legacyBrasscap());
const cookOn = (renderer: string): CookData => readCookData(json(prepared(brasscap, renderer).get('cook.json')));
const author = cookOn(PREPARED), box = cookOn(MOVED);
type Spec3 = Extract<CookData, {version: 3}>;
const spec3 = (cook: CookData): Spec3 => { if (cook.version !== 3) throw new Error('prepared() writes spec 3'); return cook; };

test('a canary recorded on another renderer with its own build label and inputHash is equal', () => {
  const relabelled: CookData = {...spec3(box), inputHash: 'f'.repeat(64), programs: {...spec3(box).programs, build: 'box-build'}, mounts: []};
  expect(canaryVerdict(author, relabelled)).toEqual({equal: true});
  expect(canaryLine('brasscap-mesa', {equal: true})).toBe('canary equal: brasscap-mesa');
  // A fence in another order is the same fence.
  expect(canaryVerdict(author, {...spec3(box), fence: [...spec3(box).fence].reverse()})).toEqual({equal: true});
});

test('a canary whose fence, packs or programs differ stops the record job until it is accepted', () => {
  const recorded = spec3(box);
  const differing: Spec3 = {...recorded, fence: [...recorded.fence, 'b'.repeat(64)],
    programs: {...recorded.programs, lines: [...recorded.programs.lines, 'void other() {}']}};
  const verdict = canaryVerdict(author, differing);
  expect(verdict).toEqual({equal: false, differs: ['fence', 'program lines']});
  expect(canaryLine('brasscap-mesa', verdict)).toBe('canary differs: brasscap-mesa: fence, program lines; no other shard records until it is accepted');
  expect(canaryOpens(verdict, new Set(), 'c'.repeat(64))).toBe(false);
  expect(canaryOpens(verdict, new Set(['c'.repeat(64)]), 'c'.repeat(64))).toBe(true);
  expect(canaryOpens({equal: true}, new Set(), 'c'.repeat(64))).toBe(true);
});

test('a canary at another spec is never equal', () => {
  const legacy = readCookData(json(brasscap.get('cook.json')));
  expect(canaryVerdict(author, legacy)).toEqual({equal: false, differs: ['spec']});
});
