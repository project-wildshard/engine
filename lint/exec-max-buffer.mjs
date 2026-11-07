// H2: captured Git inventories grow with the repository, unlike rev-parse.
// Syntax only; this rule never starts Git, reads an index or builds a TS program.
const unwrap = node => ['TSAsExpression','TSTypeAssertion','ChainExpression','ParenthesizedExpression'].includes(node?.type)
  ? unwrap(node.expression) : node;
const text = node => {
  const value=unwrap(node);
  return value?.type==='Literal'&&typeof value.value==='string'?value.value
    :value?.type==='TemplateLiteral'&&value.expressions.length===0?value.quasis[0]?.value.cooked:undefined;
};
const property = node => node?.computed?text(node.property):node?.property?.name;
const inventories=new Set(['ls-files','ls-tree','diff','status','show','log','rev-list','cat-file']);

/** Focused Node child-process rule. The config limits activation to hook helpers;
 * other script families retain their existing policies, with no new debt list. */
export const execMaxBufferRule = {
  meta:{type:'problem',docs:{description:'Give captured Git inventories an explicit maxBuffer (H2)'},schema:[]},
  create(context) {
    const named=new Map(),namespaces=new Set(),constants=new Map(),calls=[];
    const value=(node,seen=new Set())=>{
      const current=unwrap(node);
      if(current?.type!=='Identifier'||!constants.has(current.name)||seen.has(current.name))return current;
      return value(constants.get(current.name),new Set([...seen,current.name]));
    };
    // Last property wins. An unknown later spread cannot prove a bound or a
    // noncapturing stdio; an explicit property after that spread can.
    const option=(node,key,seen=new Set())=>{
      const current=value(node);
      if(current?.type!=='ObjectExpression'||seen.has(current))return undefined;
      const next=new Set([...seen,current]);
      for(const row of [...current.properties].reverse()) {
        if(row.type==='SpreadElement') {
          const spread=value(row.argument);
          if(spread?.type!=='ObjectExpression')return undefined;
          const found=option(spread,key,next);if(found!==undefined)return found;
          // A spread that contains unresolved spreads cannot prove absence.
          if(spread.properties.some(entry=>entry.type==='SpreadElement'))return undefined;
        } else if((row.computed?text(row.key):row.key.name??text(row.key))===key)return value(row.value);
      }
      return undefined;
    };
    const noncapturing=node=>{
      const current=value(node),mode=text(current);
      return mode==='inherit'||mode==='ignore'||current?.type==='Literal'&&typeof current.value==='number'&&current.value>=0;
    };
    return {
      ImportDeclaration(node) {
        if(!['node:child_process','child_process'].includes(text(node.source)))return;
        for(const row of node.specifiers) {
          if(row.type==='ImportNamespaceSpecifier'||row.type==='ImportDefaultSpecifier')namespaces.add(row.local.name);
          else if(['execFileSync','execSync','spawnSync'].includes(row.imported.name??text(row.imported)))named.set(row.local.name,row.imported.name??text(row.imported));
        }
      },
      VariableDeclarator(node) {
        if(node.id.type==='Identifier'&&node.parent?.kind==='const')constants.set(node.id.name,node.init);
      },
      CallExpression(node) {calls.push(node);},
      'Program:exit'() {
        for(const node of calls) {
          const callee=value(node.callee);
          const method=callee?.type==='Identifier'?named.get(callee.name)
            :callee?.type==='MemberExpression'&&callee.object.type==='Identifier'&&namespaces.has(callee.object.name)?property(callee):undefined;
          if(!['execFileSync','execSync','spawnSync'].includes(method))continue;
          const command=text(value(node.arguments[0]));
          let options,large=false;
          if(method==='execSync') {
            const match=/^git\s+(\S+)/u.exec(command??'');large=match!==null&&inventories.has(match[1]);options=node.arguments[1];
          } else if(command==='git') {
            const args=value(node.arguments[1]);options=node.arguments[2];
            large=args?.type!=='ArrayExpression';
            // Computed lists and arguments can select an inventory command too.
            if(args?.type==='ArrayExpression')for(const row of args.elements) {
              if(row?.type==='SpreadElement')large=true;
              if(inventories.has(text(value(row))))large=true;
              if(text(value(row))===undefined)large=true;
            }
          }
          if(!large)continue;
          const stdio=option(options,'stdio');
          if(noncapturing(stdio)||stdio?.type==='ArrayExpression'&&noncapturing(stdio.elements[1])&&noncapturing(stdio.elements[2]))continue;
          const bound=option(options,'maxBuffer');
          if(bound!==undefined&&!(bound.type==='Literal'&&(bound.value===null||typeof bound.value==='number'&&!(bound.value>0)))
            &&!(bound.type==='Identifier'&&['undefined','NaN','Infinity'].includes(bound.name)))continue;
          context.report({node,message:'Captured Git inventory requires an explicit positive maxBuffer; Node defaults to 1 MiB (H2)'});
        }
      },
    };
  },
};
