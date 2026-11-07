import { beforeAll, expect, test } from 'vitest';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { builtProduct } from './fixtures/builtProduct';
import { claim, contractKill, loadBoard, ownContractCatalogue, recordKill, saveBoard } from '../src/shared/game/quest/contracts';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { Scope } from '../src/shared/engine/app/scope';
import { ContractBoard, CONTRACT_ACTION } from '../src/shared/game/quest/contractBoard';
import { parseContractCatalogue, type ContractCatalogue } from '@wildshard/format/contracts';

// Captured from the original play-read authoring and actual page board save API.
const oldPageSave = "{\"next\":17,\"slots\":[{\"serial\":16,\"kind\":\"rarity\",\"target\":\"uncommon\",\"have\":0},{\"serial\":14,\"kind\":\"elite\",\"target\":\"imperial-bull\",\"have\":0},{\"serial\":15,\"kind\":\"species\",\"target\":\"boar\",\"have\":0}],\"claimed\":9,\"streak\":0,\"best\":2}";

let admitted: ContractCatalogue | undefined;
beforeAll(async () => {
  const loaded = await loadHeadlessProduct(builtProduct('pine-hollow'));
  const bytes = await loaded.file('quests/contracts.json');
  const parsed = parseContractCatalogue(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  // GR8 (B5): the file carries the guest's row with no bytes; the board borrows the named Wasm's loan.
  const row = parseDecisionScripts([parsed.program?.script])[0];
  if (row === undefined || parsed.program?.bytes !== '') throw new Error('The contract file names its guest without bytes');
  const owner = new Scope('contracts');
  ReturnProgram.lendModules(owner, new Map([[row.module.slice('blobs/wasm/'.length, -'.wasm'.length), await loaded.file('behaviour/pine.contracts.wasm')]]), [row]);
  admitted = ownContractCatalogue(parsed, owner);
}, 30_000);
function catalogue(): ContractCatalogue {
  if (admitted === undefined) throw new Error('The admitted catalogue is required');
  return admitted;
}

test('compiled targets retain native thralls and the older labelled coat', () => {
  const contracts = catalogue();
  expect(contractKill(contracts, { kind: 'elk', variant: 'thrall' }).tags).toEqual(['thrall']);
  expect(contractKill(contracts, { kind: 'boar', variant: 'moss', label: 'Thrall' }).tags).toEqual(['thrall']);
  expect(contractKill(contracts, { kind: 'elk', variant: 'common' }).tags).toEqual([]);
});

test('the old board save restores silently on page and native, then claims the same offer and payout', () => {
  const contracts = catalogue();
  const page = new ContractBoard({ contracts, saved: oldPageSave, prompt: { x: 0, y: 1.68, z: 0 }, radius: 3 });
  const board = loadBoard(contracts, oldPageSave);
  expect(page.current).toEqual(board);
  const rewritten = saveBoard(board);
  expect(rewritten).toBe(oldPageSave);
  const events: string[] = [];
  const native = new ContractBoard({ contracts, prompt: { x: 0, y: 1.68, z: 0 }, radius: 3 });
  const saved: unknown = JSON.parse(oldPageSave);
  native.restore({ version: 1, open: true, board: saved });
  expect(events).toEqual([]); expect(native.active).toBe(true);
  expect(native.snapshot().board).toEqual(saved);
  const slot = board.slots[0];
  if (slot === undefined) throw new Error('The captured old save has three contracts');
  const elite = contracts.elites[slot.target];
  const kill = { kind: slot.kind === 'species' ? slot.target : slot.kind === 'elite' ? elite?.kind ?? '' : 'deer',
    variant: elite?.variant, rarity: slot.kind === 'rarity' ? slot.target : 'common',
    elite: slot.kind === 'elite' ? slot.target : null, tags: slot.kind === 'thrall' ? ['thrall'] : [] };
  for (let i = 0; i < slot.need; i++) { recordKill(contracts, board, kill); page.killed(kill); native.killed(kill); }
  const reward = claim(contracts, board, 0);
  if (reward === null) throw new Error('The restored board must accept the completed offer');
  expect(page.claim(0)).toEqual({ reward, streak: board.streak });
  expect(native.use(CONTRACT_ACTION.claim0, { x: 0, y: 1.68, z: 0 })).toEqual({ reward, streak: board.streak });
  const expected = saveBoard(board);
  expect(saveBoard(page.current)).toBe(expected);
  expect(native.snapshot().board).toEqual(JSON.parse(expected));
  page.tear(1); native.use(CONTRACT_ACTION.tear0 + 1, { x: 0, y: 1.68, z: 0 });
  expect(native.snapshot().board).toEqual(JSON.parse(saveBoard(page.current)));
});
