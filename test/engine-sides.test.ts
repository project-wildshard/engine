
// oxlint-disable-next-line import/no-nodejs-modules -- Own and retire bounded source fixtures.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only exact rule and fixture paths.
import { resolve } from 'node:path';
import {expect,test} from 'vitest';
import {SIDES_FILE,SIDE_EDGES_FILE,compareSideEdges,readEdges,readSides,sideCensus} from '../lint/engine-sides.mjs';

test('the recorded counts only fall from one commit to the next',()=>{
  const before={files:{'src/game/a.ts':{'server → client':2},'src/engine/b.ts':{'shared → dom':1}}};
  expect(compareSideEdges(undefined,before)).toEqual([]);
  expect(compareSideEdges(before,{files:{'src/game/a.ts':{'server → client':1}}})).toEqual([]);
  expect(compareSideEdges(before,{files:{'src/game/a.ts':{'server → client':3}}})[0]).toContain('rose 2 → 3');
  expect(compareSideEdges(before,{files:{...before.files,'src/game/c.ts':{'client → server':1}}})[0]).toContain('src/game/c.ts client → server rose 0 → 1');
  expect(compareSideEdges(before,undefined)[0]).toContain('removed');
  // A file that moves side trades its edges for the other side's; its total can't rise.
  const moved={files:{'src/server/game/a.ts':{'server → client':6}}};
  expect(compareSideEdges(moved,{files:{'src/client/game/a.ts':{'client → server':1}}})).toEqual([]);
  expect(compareSideEdges(moved,{files:{'src/client/game/a.ts':{'client → server':7}}})[0]).toContain('rose 6 → 7 across its move');
  expect(compareSideEdges(before,{files:{'src/game/a.ts':{'client → shared':1}}})[0]).toContain('invalid');
});

test('every engine and game file is tagged and no count is above the ratchet',()=>{
  const sides=readSides(JSON.parse(readFileSync(SIDES_FILE,'utf8')));
  const recorded=readEdges(JSON.parse(readFileSync(SIDE_EDGES_FILE,'utf8')));
  const census=sideCensus(resolve('.'),sides);
  expect(census.untagged).toEqual([]);
  const rises=Object.entries(census.counts).flatMap(([path,edges])=>Object.entries(edges)
    .filter(([edge,count])=>count>(recorded[path]?.[edge]??0)).map(([edge,count])=>`${path} ${edge} ${count}`));
  expect(rises).toEqual([]);
});
