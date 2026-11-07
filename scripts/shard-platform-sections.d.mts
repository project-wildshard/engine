/** Fatal count/byte ceilings plus one explicit exit row for every custom section. */
export function customSectionFailures(root:string,measures:Record<string,{customSections:{name:string;bytes:number}[]}>):string[];
