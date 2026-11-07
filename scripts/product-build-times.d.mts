export function readProductBuildTimes(cache:string):ReadonlyMap<string,number>;
export function orderProductBuilds<T extends {name:string}>(products:readonly T[],times:ReadonlyMap<string,number>):T[];
export function recordProductBuildTimes(cache:string,measured:ReadonlyMap<string,number>,validated?:ReadonlyMap<string,number>):void;
