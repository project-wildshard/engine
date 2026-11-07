import {expect,test} from 'vitest';
import {Texture} from 'three';
import {GRAPH_ARRAY_MAX,MAX_GRAPH_BUDGET,validateGraph,type GraphIr,type GraphNode} from '@wildshard/format/materialGraph';
import {emitGraphGlsl,type GraphGlsl} from './glsl';
import {compileClassicGraph} from './glslMaterial';

function fog():GraphIr {
 return {version:1,kind:'fog',budget:MAX_GRAPH_BUDGET,params:{density:{type:'float',value:.37,min:0,max:1}},
  nodes:{input:{op:'fogInput'},density:{op:'param',param:'density'},product:{op:'mul',in:['input','density']},colour:{op:'add',in:['product',[.12,.23,.34]]}},
  stages:{fog:{colour:'colour',transmission:'density'}}};
}
function post(graph:GraphIr,name='haze'):GraphIr {
 return {version:1,kind:'post',budget:MAX_GRAPH_BUDGET,postFog:{name,graph},
  nodes:{sample:{op:'fogSample',name,in:[[.2,.3,.4],[0,0,0],[1,2,3],[0,0,0],1]},rgb:{op:'swizzle',in:['sample'],mask:'xyz'}},stages:{post:{colour:'rgb'}}};
}
function heavyFog():GraphIr {
 const inner:GraphNode={op:'loop',in:[0],count:16,body:{nodes:{a:{op:'acc'},n:{op:'noise',in:[[.2,.3]]},sum:{op:'add',in:['a','n']}},out:'sum'}};
 const outer:GraphNode={op:'loop',in:[0],count:8,body:{nodes:{a:{op:'acc'},inner,sum:{op:'add',in:['a','inner']}},out:'sum'}};
 return {...fog(),params:{},nodes:{input:{op:'fogInput'},t:outer,colour:{op:'mul',in:['input','t']}},stages:{fog:{colour:'colour',transmission:'t'}}};
}
function withoutReports(graph:GraphGlsl):unknown {
 const {executionCost,postFog,...rest}=graph;void executionCost;
 return {...rest,...(postFog===undefined?{}:{postFog:withoutReports(postFog)})};
}

test('an explicit scalar output preserves ordinary RGB lowering and avoids two reconstructed fog calls',()=>{
 const source=fog(),colour=source.stages.fog?.colour;if(colour===undefined)throw new Error('Missing fixture colour');
 const original=emitGraphGlsl({...source,stages:{fog:{colour}}},{trustedBudget:true});
 const packed=emitGraphGlsl(source,{trustedBudget:true});
 expect(packed.fog).toBe(original.fog);expect(original.fogSample).toBeUndefined();
 expect(packed.fogSample).toContain('vec4 wsGraphFogSample(');expect(packed.fogSample).not.toContain('wsGraphFog(');
 expect(packed.cost).toEqual(original.cost);
 const checked=validateGraph(source,{trustedBudget:true});expect(checked.ok).toBe(true);
 if(!checked.ok)throw new Error(checked.errors.join('; '));
 expect(checked.graph.stages.fog?.transmission).toBe('density');
});

test('nested rows retain inert JSON, named dependency, scalar and stage refusals',()=>{
 const source=fog(),input=post(source),{postFog:removed,...without}=input;void removed;
 expect(validateGraph(without,{trustedBudget:true}).ok).toBe(false);
 expect(validateGraph({...input,nodes:{...input.nodes,sample:{...input.nodes['sample'],name:'another'}}},{trustedBudget:true}).ok).toBe(false);
 expect(validateGraph({...input,postFog:{name:'haze',graph:{...source,stages:{fog:{colour:'colour'}}}}},{trustedBudget:true}).ok).toBe(false);
 for(const transmission of ['missing','input','cycle'])expect(validateGraph({...source,nodes:{...source.nodes,cycle:{op:'add',in:['cycle',1]}},stages:{fog:{colour:'colour',transmission}}},{trustedBudget:true}).ok).toBe(false);
 expect(validateGraph({...source,postFog:{name:'haze',graph:source}},{trustedBudget:true}).ok).toBe(false);
 expect(validateGraph({...input,params:{density:{type:'float',value:.5}}},{trustedBudget:true}).ok).toBe(false);
 let reads=0;const executable={...source};Object.defineProperty(executable,'nodes',{get:()=>{reads++;return source.nodes;},enumerable:true});
 expect(validateGraph({...input,postFog:{name:'haze',graph:executable}},{trustedBudget:true}).ok).toBe(false);expect(reads).toBe(0);
});

test('calls spend their full instruction cost and combined array capacity under the original caps',()=>{
 const dependency=heavyFog(),input=post(dependency),checked=validateGraph(input,{trustedBudget:true});
 expect(checked.ok).toBe(true);if(!checked.ok)throw new Error(checked.errors.join('; '));
 const second:GraphNode={op:'fogSample',name:'haze',in:[[.3,.4,.5],[0,0,0],[2,3,4],[0,0,0],1]};
 expect(validateGraph({...input,nodes:{...input.nodes,second,secondRgb:{op:'swizzle',in:['second'],mask:'xyz'},sum:{op:'add',in:['rgb','secondRgb']}},stages:{post:{colour:'sum'}}},{trustedBudget:true}).ok).toBe(false);
 expect(validateGraph({...input,budget:{...MAX_GRAPH_BUDGET,instructions:checked.cost.instructions-1}},{trustedBudget:true}).ok).toBe(false);
 const values=Array.from({length:GRAPH_ARRAY_MAX},()=>0),small=fog();
 const arrays={...small,arrays:{first:{type:'float',value:values},last:{type:'float',value:[0]}}} satisfies GraphIr;
 expect(validateGraph({...post(arrays),arrays:{own:{type:'float',value:values}}},{trustedBudget:true}).ok).toBe(false);
 const fitting={...small,arrays:{first:{type:'float',value:values}}} satisfies GraphIr;
 expect(validateGraph({...post(fitting),arrays:{own:{type:'float',value:values}}},{trustedBudget:true}).ok).toBe(true);
});

test('one shared colour/transmission call stays inside its private line branch and reports actual work',()=>{
 const input=post(heavyFog());
 const graph={...input,nodes:{...input.nodes,t:{op:'swizzle',in:['sample'],mask:'w'},half:{op:'mul',in:['t',.5]},line:{op:'combine',in:['rgb','half']},on:{op:'gt',in:[1,0]},pick:{op:'select',in:['on','line',[0,0,0,0]]},out:{op:'swizzle',in:['pick'],mask:'xyz'}},stages:{post:{colour:'out'}}};
 const plain=emitGraphGlsl(graph,{trustedBudget:true}),out=emitGraphGlsl(graph,{trustedBudget:true,reportExecutionCost:true});
 expect(withoutReports(out)).toEqual(withoutReports(plain));
 expect(out.program?.selects.branch).toBe(1);
 const body=out.program?.fragment.body;if(body===undefined)throw new Error('Missing emitted body');
 expect(body.match(/wsGraphFogSample\(/gu)).toHaveLength(1);expect(body.indexOf('if (')).toBeLessThan(body.indexOf('wsGraphFogSample('));
 expect(out.executionCost?.main?.fragment.unconditionalLoops).toBe(0);expect(out.executionCost?.main?.fragment.conditionalLoops).toBeGreaterThan(0);
 expect(out.executionCost?.main?.fragment.conditional).toBeGreaterThan(1000);
});

test('a constant loop cannot hide a costly call from its containing select',()=>{
 const input=post(heavyFog()),call=input.nodes['sample'];if(call===undefined)throw new Error('Missing fixture call');
 const graph={...input,nodes:{loop:{op:'loop',count:1,in:[[0,0,0,0]],body:{nodes:{call},out:'call'}},on:{op:'gt',in:[1,0]},pick:{op:'select',in:['on','loop',[0,0,0,0]]},out:{op:'swizzle',in:['pick'],mask:'xyz'}},stages:{post:{colour:'out'}}};
 const out=emitGraphGlsl(graph,{trustedBudget:true,reportExecutionCost:true});
 expect(out.program?.selects.branch).toBe(1);expect(out.executionCost?.main?.fragment.unconditionalLoops).toBe(0);
 expect(out.executionCost?.main?.fragment.conditionalLoops).toBeGreaterThan(0);
});

test('an outside reader retains the actual function call outside the branch',()=>{
 const input=post(heavyFog());
 const graph={...input,nodes:{...input.nodes,t:{op:'swizzle',in:['sample'],mask:'w'},on:{op:'gt',in:[1,0]},pick:{op:'select',in:['on','rgb',[0,0,0]]}},stages:{post:{colour:'pick',alpha:'t'}}};
 const out=emitGraphGlsl(graph,{trustedBudget:true,reportExecutionCost:true});
 expect(out.executionCost?.main?.fragment.unconditionalLoops).toBeGreaterThan(0);expect(out.executionCost?.main?.fragment.conditionalLoops).toBe(0);
});

test('independent row owners share only their own clone uniforms and retain numeric/borrowed texture laws',()=>{
 const source=fog();
 const graph={...source,params:{...source.params,ramp:{type:'texture',value:'ramp',role:'lent'}},arrays:{strength:{type:'float',value:[.7]}},nodes:{...source.nodes,strength:{op:'arrayElement',param:'strength',in:[0]},t:{op:'mul',in:['density','strength']},scaled:{op:'mul',in:['input','t']},tex:{op:'texture',param:'ramp',in:[[.2,.2]]},texRgb:{op:'swizzle',in:['tex'],mask:'xyz'},colour:{op:'add',in:['scaled','texRgb']}},stages:{fog:{colour:'colour',transmission:'t'}}} satisfies GraphIr;
 const a=compileClassicGraph(post(graph,'mist.one'),{trustedBudget:true}),b=compileClassicGraph(post(graph,'mist.two'),{trustedBudget:true}),copy=a.material.clone(),texture=new Texture();let disposed=false;
 texture.addEventListener('dispose',()=>{disposed=true;});
 try{
  expect(a.material.fragmentShader.match(/vec4 wsGraphFogSample\(/gu)).toHaveLength(1);expect(a.material.fragmentShader.match(/wsGraphFogSample\(/gu)).toHaveLength(2);
  expect(a.material.fragmentShader).not.toContain('vec3 wsGraphFog(');
  a.setParam('density',.25);expect(a.material.uniforms['wsFogP_density']?.value).toBe(.25);expect(b.material.uniforms['wsFogP_density']?.value).toBe(.37);
  expect(copy.uniforms['wsFogP_density']).toBe(a.material.uniforms['wsFogP_density']);expect(b.material.uniforms['wsFogP_density']).not.toBe(a.material.uniforms['wsFogP_density']);
  a.setArrayParam('strength',[.8]);const values:unknown=a.material.uniforms['wsFogA_strength']?.value;
  expect(values).toBeInstanceOf(Float32Array);if(!(values instanceof Float32Array))throw new Error('Missing array uniform');expect(values[0]).toBe(Math.fround(.8));
  a.setTexture('ramp',texture);expect(a.material.uniforms['wsFogT_ramp']?.value).toBe(texture);
  expect(()=>a.setParam('density',2)).toThrow(/range/);expect(()=>a.setParam('density',[1,2])).toThrow(/type/);expect(()=>a.setArrayParam('strength',[1,2])).toThrow(/capacity/);expect(()=>a.setTexture('density',texture)).toThrow(/lent texture/);
 }finally{copy.dispose();a.material.dispose();b.material.dispose();expect(disposed).toBe(false);texture.dispose();}
});
