// G655 TD3: syntax-only public schema admission; never build a TypeScript program.
import { SCHEMA_TYPE_RULE, schemaTypeIdentity } from '../scripts/ratchet-approval.mjs';

const factories = new Set(['any','array','bigint','blob','boolean','custom','date','enum','file','function','instance','intersect','lazy','literal',
  'looseObject','looseTuple','map','nan','never','nonNullable','nonNullish','nonOptional','null','nullable','nullish','number','object','objectWithRest',
  'optional','picklist','pipe','promise','record','set','special','strictObject','strictTuple','string','symbol','tuple','tupleWithRest','undefined',
  'union','unknown','variant','void','brand','readonly','config','description','fallback','keyof','omit','partial','pick','required','unwrap']);
const text = node => node?.type === 'Literal' ? node.value : node?.name;
const unwrap = input => {
  let node=input;
  while (['ChainExpression','ParenthesizedExpression','TSAsExpression','TSSatisfiesExpression'].includes(node?.type)) node=node.expression;
  return node;
};
const names = node => node?.type === 'Identifier' ? [node.name]
  : node?.type === 'AssignmentPattern' ? names(node.left) : node?.type === 'RestElement' ? names(node.argument)
  : node?.type === 'ObjectPattern' ? node.properties.flatMap(p=>names(p.value ?? p.argument))
  : node?.type === 'ArrayPattern' ? node.elements.flatMap(names) : [];

/** Untyped exported values/factories, including local aliases and separately named exports. */
export function untypedSchemaExports(program) {
  const namespaces=new Set(), imported=new Set(), declarations=new Map(), exports=[];
  for (const statement of program.body) {
    if (statement.type === 'ImportDeclaration' && text(statement.source) === 'valibot' && statement.importKind !== 'type') {
      for (const spec of statement.specifiers) {
        if (spec.type === 'ImportNamespaceSpecifier') namespaces.add(spec.local.name);
        else if (spec.importKind !== 'type' && factories.has(text(spec.imported)?.replace(/Async$/u,''))) imported.add(spec.local.name);
      }
    }
    const declaration=statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (declaration?.type === 'VariableDeclaration') for (const item of declaration.declarations) {
      for (const name of names(item.id)) declarations.set(name,{node:item,expression:item.init,typed:Boolean(item.id.typeAnnotation)});
    }
    if (declaration?.type === 'FunctionDeclaration' && declaration.id) declarations.set(declaration.id.name,
      {node:declaration,expression:declaration,typed:Boolean(declaration.returnType)});
    if (statement.type === 'ExportNamedDeclaration' && statement.exportKind !== 'type' && !statement.source) {
      if (declaration?.type === 'VariableDeclaration') for (const item of declaration.declarations) for (const name of names(item.id)) exports.push({name,local:name});
      if (declaration?.type === 'FunctionDeclaration' && declaration.id) exports.push({name:declaration.id.name,local:declaration.id.name});
      for (const item of statement.specifiers) if (item.exportKind !== 'type') exports.push({name:text(item.exported),local:text(item.local)});
    }
    if (statement.type === 'ExportDefaultDeclaration') {
      const node=statement.declaration;
      if (node.type === 'Identifier') exports.push({name:'default',local:node.name});
      else exports.push({name:'default',direct:{node,expression:node,typed:Boolean(node.returnType)}});
    }
  }
  function schema(input, seen=new Set(), blocked=new Set()) {
    const node=unwrap(input);
    if (!node || seen.has(node)) return false;
    const next=new Set(seen).add(node);
    if (node.type === 'Identifier') return !blocked.has(node.name) && schema(declarations.get(node.name)?.expression,next,blocked);
    if (['ArrowFunctionExpression','FunctionExpression','FunctionDeclaration'].includes(node.type)) {
      const local=new Set([...blocked,...node.params.flatMap(names)]);
      if (node.body.type !== 'BlockStatement') return schema(node.body,next,local);
      const returns=[];
      const visit=current=>{
        if (!current || typeof current !== 'object') return;
        if (current.type === 'ReturnStatement') { returns.push(current.argument);return; }
        if (['ArrowFunctionExpression','FunctionExpression','FunctionDeclaration','ClassDeclaration','ClassExpression'].includes(current.type)) return;
        for (const [key,value] of Object.entries(current)) if (key !== 'parent') {
          if (Array.isArray(value)) value.forEach(visit);else if (value && typeof value === 'object') visit(value);
        }
      };
      visit(node.body);return returns.some(value=>schema(value,next,local));
    }
    if (node.type !== 'CallExpression') return false;
    const call=unwrap(node.callee);
    if (call?.type === 'MemberExpression' && call.object.type === 'Identifier' && !blocked.has(call.object.name)
      && namespaces.has(call.object.name)) return factories.has(text(call.property)?.replace(/Async$/u,''));
    if (call?.type === 'Identifier' && !blocked.has(call.name)) {
      if (imported.has(call.name)) return true;
      const local=declarations.get(call.name)?.expression;
      if (['ArrowFunctionExpression','FunctionExpression','FunctionDeclaration'].includes(local?.type)) return schema(local,next,blocked);
    }
    return false;
  }
  return exports.flatMap(({name,local,direct})=>{
    const declaration=direct ?? declarations.get(local);
    if (!declaration || declaration.typed || Boolean(declaration.expression?.returnType)) return [];
    return name.endsWith('Schema') || schema(declaration.expression) ? [{name,node:declaration.node}] : [];
  });
}

/** Retire exact paid-down identities alongside the existing numeric ratchet update.
 * @param {Record<string,string>} allow
 * @param {(file:string)=>import('vite').ESTree.Program|null} readProgram
 * @param {readonly string[]|null} [files] */
export function pruneSchemaTypeAllowances(allow, readProgram, files=null) {
  const selected=files===null ? null : new Set(files), live=new Map();
  return Object.fromEntries(Object.entries(allow).filter(([identity])=>{
    const {file,name}=schemaTypeIdentity(identity);
    if (selected!==null && !selected.has(file)) return true;
    if (!live.has(file)) {
      const program=readProgram(file);
      live.set(file,new Set(program===null ? [] : untypedSchemaExports(program).map(row=>row.name)));
    }
    return live.get(file).has(name);
  }));
}

/** Editor/fast lint refuses new identities; count mode retains the central per-file ratchet. */
export function explicitSchemaTypes(debt, pathOf) {
  return {meta:{type:'problem',docs:{description:'Exported format schemas declare compact public types (G655)'},
    schema:[{type:'object',properties:{count:{type:'boolean'}},additionalProperties:false}]},
  create(context){
    const file=pathOf(context);
    if (!file.startsWith('src/format/') || file.endsWith('.d.ts')) return {};
    return {Program(program){
      const counted=context.options[0]?.count === true, known=debt.allow?.[SCHEMA_TYPE_RULE] ?? {},limit=debt[SCHEMA_TYPE_RULE]?.[file] ?? 0;
      for (const [index,row] of untypedSchemaExports(program).entries()) if (counted || index>=limit || !Object.hasOwn(known,`${file}#${row.name}`)) {
        context.report({node:row.node,message:`G655: exported schema ${row.name} requires an explicit public type; satisfies and casts do not replace a declaration annotation`});
      }
    }};
  }};
}
