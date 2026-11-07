export const BINARY_JSON_POLICY:'lint/no-binary-json.json';
export interface BinaryJsonCounts {base64Chars:number;dataUris:number}
export interface BinaryPolicy {schema:'no-binary-json/1';source:string;files:Record<string,BinaryJsonCounts>}
export function binaryJsonCounts(value:unknown):BinaryJsonCounts;
export function binaryJsonPolicy(value:unknown):BinaryPolicy;
export function binaryPolicyIncreases(before:BinaryPolicy,after:BinaryPolicy,message?:string):string[];
export function binaryJsonValue(text:string):unknown;
export function binaryJsonFailures(path:string,text:string,policy:BinaryPolicy):string[];
export function binaryJsonValueFailures(path:string,value:unknown,policy:BinaryPolicy):string[];
export function checkBinaryRevision(root:string,revision:string,previous:string,changed:readonly string[]):string[];
export function binaryJsonFiles(root:string):string[];
export function checkBinaryTree(directory:string,baseline?:BinaryPolicy):string[];
