// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

for(const name of ["shared/ledger","client/animation/limbQueryPose","shared/compendium/tracker","shared/grid/wallet","server/population/nativeReturns","server/population/shelter","shared/quest/contractBoard","shared/shardfile/ladder","shared/shardfile/walkInPortalRide"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game save contracts retain literal revisions, tuple poses and board fields',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-save-declarations-consumer.ts');
 let source="import * as v from 'valibot';\nimport type {CompendiumTrackerSnapshot} from '../../shared/game/compendium/tracker';\nimport type {LimbQueryPoseSaved} from '../../client/game/animation/limbQueryPose';\nimport {PortalRideStateSchema} from '../../shared/game/shardfile/walkInPortalRide';\nimport type {ContractBoard} from '../../shared/game/quest/contractBoard';\ndeclare const tracked:CompendiumTrackerSnapshot;\ndeclare const pose:LimbQueryPoseSaved;\nexport const revision:1=tracked.version;\nexport const names:string[]=tracked.heard;\nexport const ride:v.InferOutput<typeof PortalRideStateSchema>={version:2,director:\"route\",entered:null,armed:false,t:-1,from:\"\",moved:false,rides:[],refused:[]};\ndeclare const board:ReturnType<ContractBoard[\"snapshot\"]>;\nexport const boardVersion:1=board.version;\nexport const next:number=board.board.next;\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const host=ts.createCompilerHost(options),read=host.readFile.bind(host),exists=host.fileExists.bind(host);
 host.fileExists=file=>file===consumer||exists(file);
 host.readFile=file=>file===consumer?source:read(file);
 const diagnostics=():readonly ts.Diagnostic[]=>{
  const program=ts.createProgram([consumer],options,host),file=program.getSourceFile(consumer);
  if(file===undefined)throw new Error('Missing virtual declarative world consumer');
  return program.getSemanticDiagnostics(file);
 };
 expect(diagnostics()).toEqual([]);
 source+="export const wrongRevision:CompendiumTrackerSnapshot[\"version\"]=2;\nexport const wrongName:CompendiumTrackerSnapshot[\"heard\"]=[1];\nexport const wrongRideVersion:v.InferOutput<typeof PortalRideStateSchema>[\"version\"]=1;\nexport const wrongEdge:v.InferOutput<typeof PortalRideStateSchema>[\"entered\"]=\"up\";\nexport const wrongNext:ReturnType<ContractBoard[\"snapshot\"]>[\"board\"][\"next\"]=\"later\";\nexport const absent=pose.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(5);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused).toHaveLength(6);
});
