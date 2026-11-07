// Reuse the ordinary lint pass for nonzero per-file debt. The standalone
// census still uses the original visitors and reports every detection.
/** Opt-in enforcement of one existing recorded count, never a new allowance.
 * @param {object} original @param {string} name @param {object} baseline
 * @param {(context:object)=>string} pathOf */
export function recordedDebtRule(original,name,baseline,pathOf) {
  return {...original,meta:{...original.meta,schema:[{type:'object',properties:{ratchet:{type:'boolean'}},additionalProperties:false}]},
    create(context) {
      if(context.options[0]?.ratchet!==true)return original.create(context);
      const file=pathOf(context);
      // Match the full census's source-only selection.
      if(!file.startsWith('src/'))return {};
      const section=Object.hasOwn(baseline,name)?baseline[name]:{};
      if(section===null||typeof section!=='object'||Array.isArray(section))throw new Error(`Invalid recorded debt: ${name}`);
      const limit=Object.hasOwn(section,file)?section[file]:0;
      if(!Number.isSafeInteger(limit)||limit<0)throw new Error(`Invalid recorded debt: ${name} ${file}`);
      let found=0;
      const limited=Object.create(context,{report:{value:diagnostic=>{
        if(++found>limit)context.report({...diagnostic,message:`${diagnostic.message} (recorded debt ${limit}, observed ${found})`});
      }}});
      return original.create(limited);
    },
  };
}
