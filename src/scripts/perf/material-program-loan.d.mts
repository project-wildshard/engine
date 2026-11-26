export interface ProgramSource {
 readonly vertex:string;readonly fragment:string;readonly vertexHash:string;readonly fragmentHash:string;
}
export interface MaterialProgramLoan {
 readonly aliases:readonly string[];readonly before:ProgramSource;readonly after:ProgramSource;readonly uniforms:readonly string[];
}
export interface ProgramMaterial {
 readonly uuid:string;readonly name:string;vertexShader:string;fragmentShader:string;readonly uniforms:Readonly<Record<string,unknown>>;needsUpdate:boolean;
}
export interface ProgramLoanReceipt {
 readonly aliases:readonly string[];readonly materials:number;
 readonly targets:readonly {readonly uuid:string;readonly name:string}[];
 readonly before:{readonly vertexHash:string;readonly fragmentHash:string};
 readonly after:{readonly vertexHash:string;readonly fragmentHash:string};
}
export function loanMaterialPrograms(materials:readonly ProgramMaterial[],programs:readonly MaterialProgramLoan[]):Promise<{receipts:ProgramLoanReceipt[];restore:()=>void}>;
export interface ProgramDrawRenderer {renderBufferDirect:(...args:unknown[])=>unknown}
export function trackMaterialProgramDraws(renderer:ProgramDrawRenderer,receipts:readonly ProgramLoanReceipt[]):{read:()=>Record<string,number>;restore:()=>void};
