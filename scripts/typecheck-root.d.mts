/** Incremental scenario-project arguments; CI forces a fresh strict check. */
export function rootTypecheckArguments(environment?:{readonly CI?:string;readonly GITHUB_ACTIONS?:string}):string[];
