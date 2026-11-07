export function createEncodedFileCache(options?:{
  maxBytes?:number;maxFileBytes?:number;
  encode?:(file:string,encoding:'br'|'gzip',size:number)=>Promise<Buffer>;
}):{
  get:(file:string,identity:string,size:number,encoding:'br'|'gzip')=>Promise<Buffer>|undefined;
  snapshot:()=>{storedBytes:number;inFlightBytes:number;entries:number};
};
