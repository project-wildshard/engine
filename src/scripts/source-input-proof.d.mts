import type {InputHashMemo} from './input-hash-memo.mjs';
/** Current bytes/inventories must match every sealed local-phase observation. */
export function verifiedSourceSnapshot(file:string,identity:string,memo:InputHashMemo,outputs:string[]):boolean;
/** Verify the completed phase before atomically publishing local evidence. */
export function publishSourceSnapshot(file:string,identity:string,memo:InputHashMemo,outputs:Record<string,string>):void;
/** Exact controller/runtime/tool and recipe identity. */
export function sourceSnapshotIdentity(value:unknown):string;

/** Strict under CI and in the mirror; in the shared checkout a moved input only withdraws the receipt. */
export function beginProgramInputProof(root:string,products:readonly string[],env?:Readonly<Record<string,string|undefined>>):()=>void;
/** Exact root-matched mirror inventory or normal checkout HEAD; crossed/invalid evidence refuses. */
export function committedSourceFiles(root:string,env?:Readonly<Record<string,string|undefined>>):string[];
