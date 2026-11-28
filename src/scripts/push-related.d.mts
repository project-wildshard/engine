type Selection={mode:'full'|'related'|'docs';files:string[];reason:string;tests?:string[]};
export function completePushSelection(selection:Selection,options?:{cwd?:string;related?:(file:string)=>Promise<string[]>}):Promise<Selection>;
