export const DEPENDENCY_READER_LIMIT:number;
export type DependencyChange={alias:string;name:string;from:string|undefined;to:string};
export function changedDependencies(before:string,after:string):DependencyChange[];
export function versionDir(installed:string,name:string,version:string):string|null;
export function changedPackageFiles(oldDir:string,newDir:string):string[];
export function changedEntryPoints(dir:string,changed:string[]):{entry:string;distance:number}[];
export function directReaders(cwd:string,specifiers:string[],options?:{prefix?:boolean}):string[];
export function dependencyReaders(refs:string|undefined,cwd?:string):{tests:string[];notes:string[]};
