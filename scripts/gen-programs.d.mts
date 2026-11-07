export interface GenerationPlan { products:string[];folders:string[];scoped:boolean }
export function hasProjectGenerator(source:string):boolean;
export function generationPlan(root:string,requested?:string):GenerationPlan;
export function buildPrograms(root:string,plan:GenerationPlan,reuse?:boolean):Promise<number>;

export function programDiscoveryProducts(root:string):string[];
export function programInputPlan(root:string,plan:GenerationPlan):GenerationPlan;
export function emitProgramTables(root:string,plan:GenerationPlan,options:{inputsOnly:boolean;reuse?:boolean;writeTables:()=>Promise<void>;build?:typeof buildPrograms}):Promise<void>;
