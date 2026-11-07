// Run the existing JS rules over Git text using oxlint's public parser/context API.
import { RuleTester } from 'oxlint/plugins-dev';
/** @typedef {Parameters<RuleTester['run']>[1]} Rule */
let serial=0;
/** @param {Rule} rule @param {string} file @param {string} code @param {unknown[]} options @param {string} root */
export function gitRuleCount(rule,file,code,options,root) {
  let count=0;
  RuleTester.describe=(_name,run)=>run();RuleTester.it=(_name,run)=>run();
  const wrapped={...rule,create(/** @type {Parameters<NonNullable<Rule['create']>>[0]} */ context){
    const proxy=/** @type {typeof context} */(new Proxy({},{get(_target,key){if(key==='report')return ()=>{count++;};const value=Reflect.get(context,key,context);return typeof value==='function'?value.bind(context):value;}}));
    if(rule.create===undefined)throw new Error('Missing existing rule create function');
    return rule.create(proxy);
  }};
  new RuleTester({cwd:root}).run(`git-rule-${serial++}`,wrapped,{valid:[{code,filename:file,...(options.length===0?{}:{options})}],invalid:[]});
  return count;
}
