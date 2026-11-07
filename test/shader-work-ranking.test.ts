import {expect,test} from 'vitest';
import {emitGraphGlsl} from '../src/client/engine/render/graph/glsl';
import {rankShaderWork,emittedFragmentWork,type ShaderPixelFact} from './fixtures/shader-work-ranking';

const shader='a'.repeat(64),other='b'.repeat(64);
function fact(id:string,capture:string,pixels:number,fragmentShaderHash=shader):ShaderPixelFact{
 return {id,capture,name:id,fragmentShaderHash,pixels,kind:'fullscreen',saturatedPixels:0};
}
test('sum real draws within a capture and rank worst poses without adding unrelated frames',()=>{
 const result=rankShaderWork([{id:'one',fragmentShaderHash:shader,unconditional:10},{id:'alias',fragmentShaderHash:shader,unconditional:10},
  {id:'two',fragmentShaderHash:other,unconditional:20}],
 [fact('draw1','P1',20),fact('draw2','P1',30),fact('draw1','P2',40),fact('draw3','P1',30,other)]);
 expect(result.allFactsMatched).toBe(true);
 expect(result.rows.map(row=>[row.unconditionalWork,row.capture,row.pixels])).toEqual([[600,'P1',30],[500,'P1',50]]);
 expect(result.rows[1]?.programs).toEqual(['alias','one']);
});
test('a familiar label cannot join a changed shader or invent missing coverage',()=>{
 const result=rankShaderWork([{id:'silhouette',fragmentShaderHash:shader,unconditional:100}],
 [{...fact('draw','P1',100,other),name:'silhouette'}]);
 expect(result).toMatchObject({rows:[],allFactsMatched:false});expect(result.unmatched).toHaveLength(1);
});
test('colour samples and saturated readbacks stay explicitly censored proxies',()=>{
 const result=rankShaderWork([{id:'one',fragmentShaderHash:shader,unconditional:10}],
 [{...fact('draw','P1',90),kind:'colour-sample-proxy',saturatedPixels:2}]);
 expect(result.rows[0]).toMatchObject({unconditionalWork:900,proxy:true,saturatedPixels:2});
 expect(result).toMatchObject({usesProxy:true,hasSaturation:true});
 const smaller=rankShaderWork([{id:'one',fragmentShaderHash:shader,unconditional:10}],
  [fact('large','P2',100),{...fact('small','P1',10),kind:'colour-sample-proxy',saturatedPixels:1}]);
 expect(smaller.rows[0]).toMatchObject({capture:'P2',proxy:false});
 expect(smaller).toMatchObject({usesProxy:true,hasSaturation:true});
});
test('duplicate observations, invalid pixels and conflicting cost identities refuse',()=>{
 const costs=[{id:'one',fragmentShaderHash:shader,unconditional:10}];
 expect(()=>rankShaderWork(costs,[fact('same','P1',10),fact('same','P1',10)])).toThrow('Duplicate');
 for(const pixels of [-1,Infinity,Number.NaN])expect(()=>rankShaderWork(costs,[fact('draw','P1',pixels)])).toThrow('coverage');
 expect(()=>rankShaderWork([...costs,{id:'two',fragmentShaderHash:shader,unconditional:11}],[])).toThrow('Ambiguous');
 expect(()=>rankShaderWork(costs,[{...fact('draw','P1',10),saturatedPixels:1}])).toThrow('coverage');
 const bound=fact('bound','P1',100);Reflect.set(bound,'kind','viewport-upper-bound');
 expect(()=>rankShaderWork(costs,[bound])).toThrow('coverage');
});


test('actual wrapped fragments include selected fog once without multiplying vertex or light work by pixels',()=>{
 const report=(input:unknown):Parameters<typeof emittedFragmentWork>[0][number]['execution']=>{
  const result=emitGraphGlsl(input,{reportExecutionCost:true});
  if(result.executionCost===undefined)throw new Error('Missing actual execution report');return result.executionCost;
 };
 const surface=report({version:1,kind:'material',model:'standard',nodes:{noise:{op:'noise',in:[[.2,.3]]},vary:{op:'varying',in:['noise']},sun:{op:'sunColour'},lit:{op:'mul',in:['sun','vary']},litColour:{op:'litColour'},grade:{op:'mul',in:['litColour','vary']}},stages:{surface:{colour:[1,1,1]},lighting:{sun:'lit',grade:'grade'}}});
 const fog=report({version:1,kind:'fog',nodes:{noise:{op:'noise',in:[[.3,.4]]},colour:{op:'mul',in:[[1,1,1],'noise']}},stages:{fog:{colour:'colour'}}});
 const material={slug:'proof',graphHash:'surface',kind:'material' as const,fragmentShaderHashes:{main:shader,outline:null},selectedFogGraphHash:'fog',execution:surface};
 const dependency={slug:'proof',graphHash:'fog',kind:'fog' as const,fragmentShaderHashes:{main:null,outline:null},selectedFogGraphHash:null,execution:fog};
 if(surface.main===null||fog.fog===null)throw new Error('Missing source contexts');
 expect(surface.main.vertex.unconditional).toBeGreaterThan(0);expect(surface.main.sun.unconditional).toBeGreaterThan(0);expect(surface.main.grade.unconditional).toBeGreaterThan(0);
 const cost=emittedFragmentWork([material,dependency]);
 expect(cost).toHaveLength(1);
 expect(cost[0]?.unconditional).toBe(surface.main.fragment.unconditional+surface.main.grade.unconditional+fog.fog.fog.unconditional);
 const ranked=rankShaderWork(cost,[fact('native','P1',20)]);
 expect(ranked.rows[0]?.unconditionalWork).toBe(20*(surface.main.fragment.unconditional+surface.main.grade.unconditional+fog.fog.fog.unconditional));
 expect(()=>emittedFragmentWork([material])).toThrow('admitted fog');
 expect(()=>emittedFragmentWork([material,{...dependency,slug:'other'}])).toThrow('admitted fog');
 expect(()=>emittedFragmentWork([{...material,execution:{...surface,main:null}},dependency])).toThrow('no execution');
});
