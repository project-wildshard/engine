export function readFolderBuildTimes(cache:string):ReadonlyMap<string,number>;
export function orderFolderBuilds<T extends {name:string}>(products:readonly T[],times:ReadonlyMap<string,number>):T[];
export function recordFolderBuildTimes(cache:string,measured:ReadonlyMap<string,number>,validated?:ReadonlyMap<string,number>):void;
