import {expect,test} from 'vitest';
import {GRAPH_OPS,MAX_GRAPH_BUDGET,type GraphNode} from '@wildshard/format/materialGraph';
import {emitGraphGlsl,type GraphGlsl} from './glsl';

function report(input:unknown):NonNullable<GraphGlsl['executionCost']>{
 const plain=emitGraphGlsl(input,{budget:MAX_GRAPH_BUDGET});
 const {executionCost,...reported}=emitGraphGlsl(input,{budget:MAX_GRAPH_BUDGET,reportExecutionCost:true});
 expect(reported).toEqual(plain);
 if(executionCost===undefined)throw new Error('Missing requested execution report');
 return executionCost;
}
function loop(count:number):GraphNode{
 return {op:'loop',in:[0],count,body:{nodes:{a:{op:'acc'},n:{op:'noise',in:[[.2,.3]]},sum:{op:'add',in:['a','n']}},out:'sum'}};
}
function post(nodes:Record<string,GraphNode>,value:string):unknown{
 return {version:1,kind:'post',nodes:{...nodes,colour:{op:'mul',in:[[1,1,1],value]}},stages:{post:{colour:'colour'}}};
}
function opCost(name:string):number{const op=GRAPH_OPS[name];if(op===undefined)throw new Error('Missing graph op');return op.cost;}

test('fixed loops multiply their actual emitted body; a select arm stays conditional',()=>{
 const graph=(count:number):unknown=>post({condition:{op:'lt',in:[0,1]},heavy:loop(count),pick:{op:'select',in:['condition','heavy',0]}},'pick');
 const a=report(graph(4)).main?.fragment,b=report(graph(9)).main?.fragment;
 expect(a).toBeDefined();expect(b).toBeDefined();if(a===undefined||b===undefined)throw new Error('Missing post cost');
 expect(a.unconditionalLoops).toBe(0);expect(a.conditionalLoops).toBe(1);
 expect(b.unconditional).toBe(a.unconditional);
 expect(b.conditional-a.conditional).toBe(5*(opCost('noise')+opCost('add')));
});

test('a loop with an outside reader is charged outside the select',()=>{
 const result=report(post({condition:{op:'lt',in:[0,1]},heavy:loop(7),pick:{op:'select',in:['condition','heavy',0]},outside:{op:'add',in:['heavy','pick']}},'outside'));
 expect(result.main?.fragment.unconditionalLoops).toBe(1);
 expect(result.main?.fragment.conditionalLoops).toBe(0);
 expect(result.main?.fragment.conditional).toBe(0);
});

test('a shared expensive operand is hoisted once while private arms remain conditional',()=>{
 const result=report(post({condition:{op:'lt',in:[0,1]},shared:loop(5),x:{op:'noise',in:[[.2,.4]]},y:{op:'noise',in:[[.3,.6]]},yes:{op:'add',in:['shared','x']},no:{op:'add',in:['shared','y']},pick:{op:'select',in:['condition','yes','no']}},'pick'));
 expect(result.main?.fragment.unconditionalLoops).toBe(1);
 expect(result.main?.fragment.conditional).toBe(2*(opCost('noise')+opCost('add')));
});

test('nested loop multipliers preserve the containing branch',()=>{
 const graph=(count:number):unknown=>post({condition:{op:'lt',in:[0,1]},heavy:{op:'loop',in:[0],count:12,body:{nodes:{inner:loop(count)},out:'inner'}},pick:{op:'select',in:['condition','heavy',0]}},'pick');
 const a=report(graph(4)).main?.fragment,b=report(graph(8)).main?.fragment;
 if(a===undefined||b===undefined)throw new Error('Missing nested-loop report');
 expect(a.unconditionalLoops).toBe(0);expect(a.conditionalLoops).toBe(2);
 expect(b.conditional-a.conditional).toBe(12*4*(opCost('noise')+opCost('add')));
});

test('varyings charge their source to the vertex and lighting exports to fragment main',()=>{
 const vary=report({version:1,kind:'material',model:'unlit',nodes:{n:{op:'noise',in:[[.2,.3]]},v:{op:'varying',in:['n']},colour:{op:'mul',in:[[1,1,1],'v']}},stages:{surface:{colour:'colour'}}});
 expect(vary.main?.vertex.unconditional).toBe(opCost('noise'));
 expect(vary.main?.fragment.unconditional).toBe(3*opCost('mul')+opCost('varying'));
 const lit=report({version:1,kind:'material',model:'standard',nodes:{n:{op:'noise',in:[[.2,.3]]},sun:{op:'sunColour'},radiance:{op:'mul',in:['sun','n']}},stages:{surface:{colour:[1,1,1]},lighting:{sun:'radiance'}}});
 expect(lit.main?.fragment.unconditional).toBe(opCost('noise'));
 expect(lit.main?.sun.unconditional).toBe(3*opCost('mul'));
});

test('fog and outline have separate invocation costs and report no missing stage as work',()=>{
 const fog=report({version:1,kind:'fog',nodes:{n:{op:'noise',in:[[.2,.3]]},colour:{op:'mul',in:[[1,1,1],'n']}},stages:{fog:{colour:'colour'}}});
 expect(fog.main).toBeNull();expect(fog.outline).toBeNull();
 expect(fog.fog?.fog.unconditional).toBe(opCost('noise')+3*opCost('mul'));
 const outlined=report({version:1,kind:'material',model:'unlit',nodes:{n:{op:'noise',in:[[.2,.3]]},colour:{op:'mul',in:[[1,1,1],'n']}},stages:{surface:{colour:[1,1,1]},outline:{offset:[0,0,0],colour:'colour'}}});
 expect(outlined.main?.fragment.unconditional).toBe(0);
 expect(outlined.outline?.fragment.unconditional).toBe(opCost('noise')+3*opCost('mul'));
});
