import type {ESTree} from 'vite';

export function base64Call(node:ESTree.CallExpression,constants?:ReadonlyMap<string,ReadonlySet<string>>,buffers?:ReadonlySet<string>,codecs?:ReadonlySet<string>,factories?:ReadonlySet<string>):boolean;
export function base64Path(filename:string):string;
export interface Base64Visitors {
  readonly ImportDeclaration:(node:ESTree.ImportDeclaration)=>void;
  readonly VariableDeclarator:(node:ESTree.VariableDeclarator)=>void;
  readonly CallExpression:(node:ESTree.CallExpression)=>void;
  readonly 'Program:exit':()=>void;
}
export function base64Visitors(check:(node:ESTree.CallExpression)=>void):Base64Visitors;
export function base64Sites(program:ESTree.Program):number;
interface Base64Context {
  readonly filename:string;
  readonly options:readonly {readonly count?:boolean}[];
  readonly report:(issue:{readonly node:ESTree.CallExpression;readonly message:string})=>void;
}
export function noBase64Rule(policyFile:string|URL):{meta:object;create:(context:Base64Context)=>Partial<Base64Visitors>};
export const BASE64_POLICY:string;
