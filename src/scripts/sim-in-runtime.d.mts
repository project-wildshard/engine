export interface SimRuntimeRow {entries:string[];files:string[]}
/** Conservative transitive value-module reach from native entry factories. */
export function simRuntimeInventory(root?:string):Record<string,SimRuntimeRow>;
/** Both per-shard counts and exact debt identities are shrink-only. */
export function simRuntimeFailures(policy:{budgets?:Record<string,number>;allow?:Record<string,Record<string,string>>},inventory:Record<string,SimRuntimeRow>):string[];
export function checkSimRuntime(root?:string):string[];
