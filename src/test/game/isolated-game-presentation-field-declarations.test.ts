// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

for(const name of ["client/boss/encounterView","client/looks/keyedSky","client/models/collectionWall","client/plugin/heldFirearm","client/plugin/heldTool","server/plugin/mover","shared/quest/eliteDecisions","client/riding/hud","client/riding/reins","server/riding/roster","client/shardfile/emptyEquipment","client/shardfile/sceneDressing","client/shardfile/sceneMotion","client/systems/looks/particles","client/systems/looks/waterSurface","client/systems/npc/figureRows","client/systems/npc/kitFigure","client/systems/tools/hoverboard"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game presentation owners retain mutable resources and readonly handles',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-presentation-field-declarations-consumer.ts');
 let source="import type {Group} from 'three';\nimport type {Scope} from '@wildshard/engine/app/scope';\nimport type {TrophyWall} from '../../client/game/models/collectionWall';\nimport type {HeldFirearm} from '../../client/game/plugin/heldFirearm';\nimport type {WaterSurface} from '../../client/game/systems/looks/waterSurface';\nimport type {Hoverboard} from '../../client/game/systems/tools/hoverboard';\ndeclare const wall:TrophyWall;\ndeclare const firearm:HeldFirearm;\ndeclare const water:WaterSurface;\ndeclare const board:Hoverboard;\nexport const owner:Scope=wall.scope;\nexport const root:Group=wall.group;\nexport const model:Group=board.model;\nwater.group.position.y=1;\nfirearm.inspectYaw=0;\n";
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
 source+="wall.group=wall.group;\nwall.scope=wall.scope;\nboard.model=board.model;\nexport const wrongOwner:number=wall.scope;\nfirearm.inspectYaw=\"later\";\nexport const missing=water.group.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(3);
 expect(refused).toHaveLength(6);
});
