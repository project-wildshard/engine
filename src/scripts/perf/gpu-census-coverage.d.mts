export interface GraphCoverageRow {alias:string;samples:number;coveredPixels:number;saturatedPixels:number;fragmentShaderHashes?:string[]}
export interface GraphCoverage {width:number;height:number;method:string;rows:GraphCoverageRow[]}
/** Native-order depth-passing samples; final-output diagnostic, not shader invocations. */
export function graphCoverage(extraAliases?:readonly string[]):GraphCoverage;
/** Additional native names selected only by exact compiled source identity. */
export function sourceMatchedCoverageAliases(materials:readonly {name:string;fragmentShaderHash?:string}[],hashes:readonly string[]):string[];
