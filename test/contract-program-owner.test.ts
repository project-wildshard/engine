import { expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { realGc } from '@wildshard/engine/test/realGc';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { CONTRACTS } from './fixtures/pine-contracts';
import { contractKill, draw, loadBoard, ownContractCatalogue, saveBoard } from '../src/shared/game/quest/contracts';

const original = CONTRACTS;
const declaration = original.program;
if (declaration === undefined) throw new Error('Missing original contract programme');
function originalScript() {
  const row = parseDecisionScripts([original.program?.script])[0];
  if (row === undefined) throw new Error('Missing contract script');
  return row;
}
const script = originalScript();
const hash = script.module.slice('blobs/wasm/'.length, -'.wasm'.length);
const bytes = Uint8Array.from(atob(declaration.bytes), value => value.codePointAt(0) ?? 0);
const raw = { ...original, program: { script, bytes: '' } };
function lend(owner: Scope, input = bytes): void {
  ReturnProgram.lendModules(owner, new Map([[hash, input]]), [script]);
}

test('owned raw catalogues retain every offer, predicate and board save', () => {
  const root = new Scope('contract-root'), owner = root.child('entered');
  try {
    lend(root);
    const rows = ownContractCatalogue(raw, owner);
    expect(rows).not.toBe(raw);
    expect(rows.program?.bytes).toBe('');
    expect(Array.from({ length: 128 }, (_, serial) => draw(rows, serial)))
      .toEqual(Array.from({ length: 128 }, (_, serial) => draw(original, serial)));
    for (const kind of ['elk', 'boar', 'deer']) for (const variant of ['thrall', 'common', 'moss'])
      expect(contractKill(rows, { kind, variant })).toEqual(contractKill(original, { kind, variant }));
    const saved = saveBoard(loadBoard(original, null));
    expect(saveBoard(loadBoard(rows, saved))).toBe(saved);
    owner.dispose();
    expect(() => draw(rows, 100)).toThrow('disposed');
    expect(() => draw(original, 100)).not.toThrow();
  } finally { root.dispose(); }
});

test('raw catalogues require the exact live scope loan and never rescue corrupt bytes', () => {
  const root = new Scope('contract-loan'), other = new Scope('unrelated');
  try {
    expect(() => ownContractCatalogue(raw, root)).toThrow('loan');
    expect(() => lend(root, new Uint8Array([0]))).toThrow('hash mismatch');
    lend(root);
    expect(() => ownContractCatalogue(raw, other)).toThrow('loan');
    expect(() => ownContractCatalogue({ ...raw, program: { script: { ...script, pages: 2 }, bytes: '' } }, root)).toThrow('contract mismatch');
    root.dispose();
    expect(() => ownContractCatalogue(raw, root)).toThrow('disposed');
  } finally { root.dispose(); other.dispose(); }
});

test('independent owners can borrow the same catalogue without sharing retirement', () => {
  const first = new Scope('first'), next = new Scope('next');
  try {
    lend(first); lend(next);
    const a = ownContractCatalogue(raw, first), b = ownContractCatalogue(raw, next);
    expect(a).not.toBe(b);
    expect(draw(a, 127)).toEqual(draw(b, 127));
    first.dispose();
    expect(() => draw(a, 127)).toThrow('disposed');
    expect(draw(b, 127)).toEqual(draw(original, 127));
  } finally { first.dispose(); next.dispose(); }
});

function retired() {
  const scope = new Scope('retired-contract');
  lend(scope);
  const rows = ownContractCatalogue(raw, scope), ref = new WeakRef(scope);
  scope.dispose();
  return { rows, ref };
}
test('a retained catalogue releases its retired Scope and refuses later projection', async () => {
  await realGc('test/contract-program-owner.test.ts', 'a retained catalogue releases its retired Scope and refuses later projection', async collect => {
    const { rows, ref } = retired();
    await collect(ref);
    expect(() => draw(rows, 0)).toThrow('disposed');
    expect(rows.program?.bytes).toBe('');
  });
});
