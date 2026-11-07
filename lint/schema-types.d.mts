import type { ESTree } from 'vite';

export interface SchemaTypeExport { readonly name:string; readonly node:ESTree.Node }
export function untypedSchemaExports(program:ESTree.Program):SchemaTypeExport[];
export function pruneSchemaTypeAllowances(allow:Readonly<Record<string,string>>,readProgram:(file:string)=>ESTree.Program|null,files?:readonly string[]|null):Record<string,string>;
interface SchemaTypeContext { readonly filename:string;readonly options:readonly {readonly count?:boolean}[];report:(issue:{node:ESTree.Node;message:string})=>void }
export function explicitSchemaTypes(debt:{allow?:Record<string,Record<string,string>>;'wildshard/explicit-schema-types'?:Record<string,number>},pathOf:(context:SchemaTypeContext)=>string):{
 meta:object;create:(context:SchemaTypeContext)=>{Program?:(program:ESTree.Program)=>void};
};
