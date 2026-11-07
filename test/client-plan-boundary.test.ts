// oxlint-disable-next-line import/no-nodejs-modules -- The architecture guard reads small isolated source fixtures.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- All fixture files stay under the repository's ignored tmp directory.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { clientPlanSchemaViolations } from '../lint/client-plan-boundary.mjs';

function fixture(run: (root: string, nested: (source: string) => void) => void): void {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/client-plan-schema-'));
  mkdirSync(resolve(root, 'node_modules/@wildshard/format/src/format'), { recursive: true });
  mkdirSync(resolve(root, 'src/client/game/shardfile'), { recursive: true });
  writeFileSync(resolve(root, 'node_modules/@wildshard/format/src/format/clientPlan.ts'), 'export const ClientPlanSchema = {version:1};');
  writeFileSync(resolve(root, 'src/client/game/shardfile/clientPlan.ts'), "export const FEATURES={view:{sections:['fixture/rows']}};");
  writeFileSync(resolve(root, 'node_modules/@wildshard/format/src/format/platformDataSections.ts'), "import { Schema } from './nested'; export const PLATFORM_DATA_SECTIONS={'fixture/rows':{schema:Schema}} as const;");
  try { run(root, source => { writeFileSync(resolve(root, 'node_modules/@wildshard/format/src/format/nested.ts'), source); }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('client feature guard follows required section schemas without charging unrelated legacy schemas', () => {
  fixture((root, nested) => {
    nested("const borrowed={owner:'runtime',path:['method']}; export const Legacy=borrowed; export const Schema={name:'safe'};");
    expect(clientPlanSchemaViolations(root)).toEqual([]);
    nested("const borrowed={owner:'runtime',path:['method']}; export const Schema=borrowed;");
    expect(clientPlanSchemaViolations(root)).toEqual([expect.stringContaining('reflected {owner,path}')]);
    writeFileSync(resolve(root, 'node_modules/@wildshard/format/src/format/loan.ts'), 'const loan={owner:"runtime",path:[]};export default loan;');
    nested("import loan from './loan'; export const Schema=loan;");
    expect(clientPlanSchemaViolations(root)).toEqual([expect.stringContaining('reflected {owner,path}')]);
    // P1-F1 J53: format's relative imports name their `.ts` file.
    nested("import loan from './loan.ts'; export const Schema=loan;");
    expect(clientPlanSchemaViolations(root)).toEqual([expect.stringContaining('reflected {owner,path}')]);
  });
});

test('borrowed-owner types and executable dependency lists cannot hide a schema escape', () => {
  fixture((root, nested) => {
    nested('interface BorrowedOwnerPath {owner:string;path:string[]} export const Schema: BorrowedOwnerPath = {owner:"runtime",path:[]};');
    expect(clientPlanSchemaViolations(root)).toEqual(expect.arrayContaining([expect.stringContaining('BorrowedOwnerPath')]));
    nested('export const Schema={name:"safe"};');
    writeFileSync(resolve(root, 'src/client/game/shardfile/clientPlan.ts'), 'export const FEATURES={view:{sections:getSections()}};');
    expect(clientPlanSchemaViolations(root)).toEqual([expect.stringContaining('literal section names')]);
  });
});

test('creature pose dependencies admit finite inputs while legacy channel owner paths remain fenced', () => {
  fixture((root, nested) => {
    writeFileSync(resolve(root, 'node_modules/@wildshard/format/src/format/clientChannels.ts'), readFileSync(resolve('node_modules/@wildshard/format/src/format/clientChannels.ts'), 'utf8'));
    nested("import { NumericPoseSchema } from './clientChannels'; export const Schema=NumericPoseSchema;");
    expect(clientPlanSchemaViolations(root)).toEqual([]);
    nested("import { ClientChannelsSchema } from './clientChannels'; export const Schema=ClientChannelsSchema;");
    expect(clientPlanSchemaViolations(root)).toEqual(expect.arrayContaining([expect.stringContaining('reflected {owner,path}')]));
  });
});


test('legacy root envelopes retain the same schema traversal and refuse reflected inputs', () => {
  fixture((root, nested) => {
    writeFileSync(resolve(root, 'node_modules/@wildshard/format/src/format/platformDataSections.ts'), "import { Schema } from './nested'; export const PLATFORM_DATA_SECTIONS={} as const; export const CLIENT_ENVELOPE_SECTIONS={'fixture/rows':{schema:Schema}} as const;");
    nested('export const Schema={movers:[]};');
    expect(clientPlanSchemaViolations(root)).toEqual([]);
    nested('export const Schema={movers:{owner:"runtime",path:[]}};');
    expect(clientPlanSchemaViolations(root)).toEqual([expect.stringContaining('reflected {owner,path}')]);
    nested('export const Schema={movers:[]};');
    writeFileSync(resolve(root, 'src/client/game/shardfile/clientPlan.ts'), "export const FEATURES={view:{sections:['unknown/rows']}};");
    expect(clientPlanSchemaViolations(root)).toEqual([expect.stringContaining('missing client section schema unknown/rows')]);
  });
});
