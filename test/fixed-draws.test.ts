import { FixedDrawRowsSchema } from '@wildshard/format/fixedDraws';
import { namedJsonSchema } from '../src/shared/host/formatJsonSchema';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';
import { fixedDrawModel as driftwoodFixedModel } from './fixtures/fixed-draw-models';
import { expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { zlibSync } from 'fflate';
import { coldFixedDraws, fixedDraws, folderFixedDraws } from '../src/client/game/models/fixedDraws';
import { Scope } from '../src/shared/engine/app/scope';
import { createOwnedGeometry } from '../src/client/engine/models/ownedGeometry';

// G571: a product's named fixed draws (Driftwood's fixed-model templates) loaded together as owned templates.
const tri = (x: number): BufferGeometry => new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array([x, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
const rows = [{ slot: 'gull', file: 'models/fixed/gull.glb', channels: [] }, { slot: 'reefFish', file: 'models/fixed/reef-fish.glb', channels: [] }];
const product = { slug: 'fixture', file: () => Promise.reject(new Error('read through the product')) };

test('every slot loads together from named sources and copies its own template', async () => {
  const draws = fixedDraws(product, rows);
  expect(draws.ready).toBe(false);
  await draws.load(new Map([['models/fixed/gull.glb', tri(7)], ['models/fixed/reef-fish.glb', tri(9)]]));
  expect(draws.ready).toBe(true);
  const gull = draws.handle('gull').copy(), fish = draws.handle('reefFish').copy();
  expect(gull.getAttribute('position').getX(0)).toBe(7); expect(fish.getAttribute('position').getX(0)).toBe(9);
  expect(gull).not.toBe(draws.handle('gull').copy());
});

test('an undeclared, missing or repeated slot refuses; no source reads the product', async () => {
  expect(() => fixedDraws(product, [...rows, rows[0]])).toThrow('Repeated');
  const draws = fixedDraws(product, rows);
  expect(() => draws.handle('crab')).toThrow('Undeclared');
  await expect(draws.load(new Map([['models/fixed/gull.glb', tri(1)]]))).rejects.toThrow('Missing fixed draw: reefFish');
  expect(draws.ready).toBe(false);
  await expect(draws.load()).rejects.toThrow('read through the product');
});

test('a cold card owns exactly its slots, read through the product, and releases them with its scope', async () => {
  const gull = await driftwoodFixedModel('gull');
  const read = { slug: 'fixture', file: (name: string) => name === 'models/fixed/gull.glb' ? Promise.resolve(gull) : Promise.reject(new Error(`unread ${name}`)) };
  const card = new Scope('card');
  const draws = await coldFixedDraws(read, rows, card, ['gull']);
  expect(draws.ready).toBe(true); expect(() => draws.handle('reefFish')).toThrow('Undeclared');
  const copy = draws.handle('gull').copy(); expect(copy.getAttribute('position').count).toBeGreaterThan(0);
  card.dispose(); expect(() => draws.handle('gull').copy()).toThrow();
  await expect(coldFixedDraws(read, rows, new Scope('x'), ['gull', 'gull'])).rejects.toThrow('undeclared or repeated');
  await expect(coldFixedDraws(read, rows, new Scope('y'), ['crab'])).rejects.toThrow('undeclared or repeated');
  const closing = new Scope('closing'), pending = coldFixedDraws(read, rows, closing, ['gull']); closing.dispose();
  await expect(pending).rejects.toThrow('owner left');
});

// sp-x8 QX: lifetime regressions for the cold entry
const bytes = driftwoodFixedModel;
function deferred() { let settle: (value: Uint8Array) => void = () => undefined;
  const promise = new Promise<Uint8Array>(resolve => { settle = resolve; }); return { promise, resolve: (value: Uint8Array) => { settle(value); } }; }
// the real template intake, signalling each slot's decode completion to the test (the dependency passed in, E422)
function signalled() {
  const waiting = new Map<string, () => void>();
  const decoded = (slot: string): Promise<void> => new Promise(resolve => { waiting.set(slot, resolve); });
  const template: typeof createOwnedGeometry = (slot, channels) => {
    const handle = createOwnedGeometry(slot, channels);
    return { ...handle, load: async (...args) => { await handle.load(...args); waiting.get(slot)?.(); } };
  };
  return { decoded, template };
}
test('closing during a read releases a slot that finished early and refuses; a closed card hands out nothing', async () => {
  const late = deferred(), disposed = vi.spyOn(BufferGeometry.prototype, 'dispose');
  try {
    const card = new Scope('card'), read = { slug: 'fixture', file: (name: string) => name.endsWith('gull.glb') ? bytes('gull') : late.promise };
    const signal = signalled(), gullDecoded = signal.decoded('gull'), pending = coldFixedDraws(read, rows, card, ['gull', 'reefFish'], signal.template);
    await gullDecoded;
    const before = disposed.mock.calls.length;
    card.dispose(); late.resolve(await bytes('reef-fish'));
    await expect(pending).rejects.toThrow('owner left');
    expect(disposed.mock.calls.length - before).toBe(1);
  } finally { disposed.mockRestore(); }
  const card = new Scope('card'), draws = await coldFixedDraws({ slug: 'fixture', file: () => bytes('gull') }, rows, card, ['gull']);
  card.dispose();
  expect(draws.ready).toBe(false); expect(() => draws.handle('gull')).toThrow('owner left'); await expect(draws.load()).rejects.toThrow('owner left');
});
test('an ancestor retiring (disposing, the card still live) during a read refuses', async () => {
  const late = deferred(), parent = new Scope('cell'), card = parent.child('card');
  parent.onDispose(() => undefined); // retired first (newest first): the card is still live while its ancestor retires
  const pending = coldFixedDraws({ slug: 'fixture', file: () => late.promise }, rows, card, ['gull']);
  const steps = parent.disposeSteps(); steps.next();
  expect(card.disposed).toBe(false); expect(card.disposing).toBe(true);
  late.resolve(await bytes('gull'));
  await expect(pending).rejects.toThrow('owner left');
  for (let step = steps.next(); step.done !== true; step = steps.next()) { /* finish the retirement */ }
});
test('a partial read failure releases every slot that loaded and reports the failure', async () => {
  const disposed = vi.spyOn(BufferGeometry.prototype, 'dispose');
  try {
    const card = new Scope('card'), read = { slug: 'fixture', file: (name: string) => name.endsWith('gull.glb') ? bytes('gull') : Promise.reject(new Error('reef fish unreadable')) };
    const before = disposed.mock.calls.length;
    await expect(coldFixedDraws(read, rows, card, ['gull', 'reefFish'])).rejects.toThrow('reef fish unreadable');
    expect(disposed.mock.calls.length - before).toBe(1);
    card.dispose();
    expect(disposed.mock.calls.length - before).toBe(1);
  } finally { disposed.mockRestore(); }
});

// G602/G603: a fixed draw row may name a baked geometry block instead of a GLB (Nalati's prepared shapes)
const baked = { attrs: [['position', 'f32', 3, false], ['aTone', 'u8', 1, true]] as [string, 'f32' | 'u8', number, boolean][], count: 3, index: 'u16' as const, indexCount: 3, box: true, expand: false };
function block(x: number): Uint8Array {
  const position = new Float32Array([x, 0, 0, 1, 0, 0, 0, 1, 0]), tone = new Uint8Array([10, 20, 30, 0]), deltas = new Int32Array([0, 1, 1]);
  const out = new Uint8Array(position.byteLength + tone.byteLength + deltas.byteLength);
  out.set(new Uint8Array(position.buffer), 0); out.set(tone, position.byteLength); out.set(new Uint8Array(deltas.buffer), position.byteLength + tone.byteLength);
  return out;
}
const stoneRow = { slot: 'stone', file: 'shapes/stone.bin', channels: [['aTone', 'tone']] as [string, string][], baked };
const bakedRows = [stoneRow, { slot: 'flat', file: 'shapes/flat.bin', channels: [], baked: { ...baked, expand: true } }];

test('a baked row decodes its block exactly, renames its channels and expands when declared', async () => {
  const files = new Map([['shapes/stone.bin', block(4)], ['shapes/flat.bin', block(6)]]);
  const read = { slug: 'fixture', file: (name: string) => { const found = files.get(name); return found === undefined ? Promise.reject(new Error(`unread ${name}`)) : Promise.resolve(found); } };
  const draws = fixedDraws(read, bakedRows);
  await draws.load();
  const stone = draws.handle('stone').copy(), flat = draws.handle('flat').copy();
  expect(stone.getAttribute('position').getX(0)).toBe(4); expect(stone.hasAttribute('tone')).toBe(true); expect(stone.hasAttribute('aTone')).toBe(false);
  expect(Array.from(stone.getIndex()?.array ?? [])).toEqual([0, 1, 2]); expect(stone.boundingBox).not.toBeNull();
  expect(flat.getIndex()).toBeNull(); expect(flat.getAttribute('position').getX(0)).toBe(6);
  // a card's cold copy reads the same row through the product
  const card = new Scope('card'), cold = await coldFixedDraws(read, bakedRows, card, ['stone']);
  expect(cold.handle('stone').copy().getAttribute('position').getX(0)).toBe(4); card.dispose();
});

test('a baked row refuses a wrong byte count, a missing channel or geometry instead of bytes', async () => {
  const short = { slug: 'fixture', file: () => Promise.resolve(block(1).slice(0, 8)) };
  await expect(fixedDraws(short, [stoneRow]).load()).rejects.toThrow('byte count differs: stone');
  const read = { slug: 'fixture', file: () => Promise.resolve(block(1)) };
  await expect(fixedDraws(read, [{ ...stoneRow, channels: [['aMissing', 'x']] }]).load()).rejects.toThrow('missing aMissing: stone');
  await expect(fixedDraws(product, [stoneRow]).load(new Map([['shapes/stone.bin', tri(1)]]))).rejects.toThrow('needs its file bytes: stone');
});

// G602: binary blocks keep lane offsets and independent named-file geometry.
const joined = (a: Uint8Array, b: Uint8Array): Uint8Array => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };
const base64 = (data: Uint8Array): string => btoa(String.fromCodePoint(...data));
test('lane rows read their blocks once while independent named rows retain expansion', async () => {
  const bake = joined(block(1), block(2)), reads: string[] = [];
  const reader = (url: string): Promise<Uint8Array> => { reads.push(url); return Promise.resolve(bake); };
  const laneRows = [{ slot: 'first', lane: { url: '/assets/fixture.bin', offset: 0 }, channels: [], baked },
    { slot: 'second', lane: { url: '/assets/fixture.bin', offset: 52 }, channels: [], baked },
    { slot: 'flat', file:'models/flat.bin', channels: [], baked: { ...baked, expand: true } }];
  const draws = fixedDraws({...product,file:()=>Promise.resolve(block(3))}, laneRows, undefined, reader);
  await draws.load();
  expect(reads).toEqual(['/assets/fixture.bin']);
  expect(draws.handle('first').copy().getAttribute('position').getX(0)).toBe(1);
  expect(draws.handle('second').copy().getAttribute('position').getX(0)).toBe(2);
  expect(draws.handle('flat').copy().getIndex()).toBeNull();
  const now = draws.handle('flat').copy(); expect(now.getAttribute('position').getX(0)).toBe(3);now.dispose();
  // supplied bytes stand in for the bake under its url
  const given = fixedDraws(product, laneRows.slice(0, 2), undefined, () => Promise.reject(new Error('fetched')));
  await given.load(new Map([['/assets/fixture.bin', bake]]));
  expect(given.handle('second').copy().getAttribute('position').getX(0)).toBe(2);
});

test('a lane block past its bake, two sources or a lane without its baked layout refuse', async () => {
  const reader = (): Promise<Uint8Array> => Promise.resolve(block(1));
  await expect(fixedDraws(product, [{ slot: 'past', lane: { url: '/b.bin', offset: 8 }, channels: [], baked }], undefined, reader).load()).rejects.toThrow('exceeds its lane bake: past');
  expect(() => fixedDraws(product, [{ slot: 'two', file: 'a.glb', lane: { url: '/b.bin', offset: 0 }, channels: [], baked }])).toThrow();
  expect(() => fixedDraws(product, [{ slot: 'raw', lane: { url: '/b.bin', offset: 0 }, channels: [] }])).toThrow();
  expect(() => fixedDraws(product,[{slot:'inline',inline:base64(zlibSync(block(1))),channels:[],baked}])).toThrow('require binary sources');
});

test('metadata-only libraries retain binary URL lanes and refuse undeclared product readers',async()=>{
  const row={slot:'lane',lane:{url:'/assets/fixture.bin',offset:0},channels:[],baked};
  const library=await folderFixedDraws({json:()=>Promise.resolve([row])},'draws');
  await library.load(new Map([['/assets/fixture.bin',block(5)]]));
  expect(library.handle('lane').copy().getAttribute('position').getX(0)).toBe(5);
  await expect(folderFixedDraws({json:()=>Promise.resolve([{slot:'glb',file:'models/a.glb',channels:[]}])},'draws')).rejects.toThrow('file reader required');
});

test('fixed-draw data refuses accessors, cycles and extra channel operands before decoding', () => {
  let reads = 0;
  const row = { slot: 'inline', inline: base64(zlibSync(block(5))), channels: [], baked };
  const getter = { get slot() { reads++; return 'inline'; }, inline: row.inline, channels: [], baked };
  const cycle: Record<string, unknown> = { ...row }; cycle['self'] = cycle;
  const allocate = vi.spyOn(BufferGeometry.prototype, 'setAttribute');
  try {
    for (const malformed of [getter, cycle, { ...row, channels: [['aTone', 'tone', 'extra']] }, { ...row, run: () => undefined }]) {
      expect(() => fixedDraws(product,[malformed])).toThrow();
      expect(() => fixedDraws(product,[row,malformed])).toThrow();
    }
    expect(reads).toBe(0); expect(allocate).not.toHaveBeenCalled();
  } finally { allocate.mockRestore(); }
});


test('fixed-draw named admission keeps exact channel-pair arity', () => {
  const schema = namedJsonSchema(FixedDrawRowsSchema);
  const row = { slot: 'inline', inline: base64(zlibSync(block(5))), channels: [['aTone', 'tone']], baked };
  expect(() => validateNamedJsonSchema(schema, new TextEncoder().encode(JSON.stringify([row])))).not.toThrow();
  expect(() => validateNamedJsonSchema(schema, new TextEncoder().encode(JSON.stringify([{ ...row, channels: [['aTone', 'tone', 'extra']] }])))).toThrow();
});

test('a product file of baked rows is one library per product and file; a failure stays; a changed reader refuses', async () => {
  const row = { slot: 'inline',file:'models/block.bin',channels:[],baked };
  let reads = 0;
  const book = { slug:'memo-fixture',file:()=>Promise.resolve(block(5)),json: (name: string) => { reads++; return name === 'models/book.json' ? Promise.resolve([row]) : Promise.reject(new Error(`unread ${name}`)); } };
  const first = await folderFixedDraws(book, 'models/book.json');
  expect(await folderFixedDraws(book, 'models/book.json')).toBe(first); expect(reads).toBe(1);
  await first.load(); expect(first.handle('inline').copy().getAttribute('position').getX(0)).toBe(5);
  const other = { slug:'memo-fixture',file:book.file,json: book.json };
  expect(await folderFixedDraws(other, 'models/book.json')).not.toBe(first);
  await expect(folderFixedDraws(book, 'models/absent.json')).rejects.toThrow('unread');
  await expect(folderFixedDraws(book, 'models/absent.json')).rejects.toThrow('unread'); expect(reads).toBe(3);
  const swapped: { json: (name: string) => Promise<unknown> } = { json: () => { swapped.json = () => Promise.resolve([row]); return Promise.resolve([row]); } };
  await expect(folderFixedDraws(swapped, 'models/book.json')).rejects.toThrow('reader changed');
});

test('product fixed draws read baked files through the same concrete product receiver', async () => {
  const row = {slot:'binary',file:'models/block.bin',channels:[],baked};
  const book = {slug:'binary-book',json:():Promise<unknown>=>Promise.resolve([row]),file(name:string):Promise<Uint8Array>{
    expect(this).toBe(book);expect(name).toBe(row.file);return Promise.resolve(block(11));
  }};
  const draws = await folderFixedDraws(book,'models/book.json');
  expect(await folderFixedDraws(book,'models/book.json')).toBe(draws);
  await draws.load();expect(draws.ready).toBe(true);
  const geometry = draws.handle(row.slot).copy();expect(geometry.getAttribute('position').getX(0)).toBe(11);geometry.dispose();
  await expect(folderFixedDraws({json:()=>Promise.resolve([row])},'models/book.json')).rejects.toThrow('file reader required');
});

test.each(['json','file'] as const)('product fixed draws refuse replaced %s while binary intake is pending', async key => {
  let finish: (bytes:Uint8Array)=>void = ()=>{throw new Error('Missing pending byte reader');};
  const pending = new Promise<Uint8Array>(resolve=>{finish=resolve;});
  const row = {slot:'binary',file:'models/block.bin',channels:[],baked};
  const book = {slug:'binary-book',json:():Promise<unknown>=>Promise.resolve([row]),file:():Promise<Uint8Array>=>pending};
  const draws = await folderFixedDraws(book,'models/book.json'),loading = draws.load();
  if(key==='json')book.json=()=>Promise.resolve([row]);
  else book.file=()=>Promise.resolve(block(99));
  finish(block(11));
  await expect(loading).rejects.toThrow('reader changed');expect(draws.ready).toBe(false);
});

test('product fixed draws pin the binary reader before awaiting metadata', async () => {
  let finish:(rows:unknown)=>void=()=>{throw new Error('Missing pending metadata reader');};
  const pending=new Promise<unknown>(resolve=>{finish=resolve;});
  const book={slug:'binary-book',json:()=>pending,file:()=>Promise.resolve(block(11))};
  const loading=folderFixedDraws(book,'models/book.json');
  book.file=()=>Promise.resolve(block(99));
  finish([{slot:'binary',file:'models/block.bin',channels:[],baked}]);
  await expect(loading).rejects.toThrow('reader changed');
});
