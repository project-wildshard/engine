import type { Shardfile } from '@wildshard/format/shardSchema';

export interface BakeCamera { name:string; eye:[number,number,number]; yaw:number; pitch:number; fov:number; origin:'spawn'|'entry'|'declared' }
export interface BakePart { id:string; files:readonly string[] }
export interface BakeChunk { id:string; tile:number; bytes:number; box:[number,number,number,number,number,number]; geometricError:number }
export interface TilingInput { slug:string; ring?:'cell'; tiles:Shardfile['tiles']; cameras:readonly BakeCamera[]; parts:readonly BakePart[]; chunks:readonly BakeChunk[] }
export interface TileRow { key:string; lod:number; x:number; z:number; gpu:number; decoded:number; resident:number; compressed:number; triangles:number; draws:number; minY:number; maxY:number; height:number; tall:boolean; geometricError:number; occupied:boolean; over:string[] }
export interface SightlineRow { name:string; origin:BakeCamera['origin']; eyeY:number; visible:number; outside:number; fraction:number; cut:boolean; over20:boolean; minDistance:number|null; maxDistance:number|null; heavy:{tile:string; distance:number; metresPerPixel:number}[] }
export interface LevelCost { gpu:number; resident:number; compressed:number; triangles:number; draws:number; occupied:number }
export interface TilingReport { slug:string; ring:'cell'|'5x5'; tiles:TileRow[]; chunks:BakeChunk[]; l0:LevelCost; l1:LevelCost; topFiveShare:number; tallest:number; overCaps:number; zeroError:number; spanning:{id:string; tiles:number}[]; sightlines:SightlineRow[]; cut:number; over20:number; thin:boolean; l1Ratio:number; verdict:string[]; provenance?:{indexHash:string; cameraHash:string|null} }
export interface NineTilingBaseline { version:1; product:'nine-dragon-stack'; ring:'cell'; chunks:{bytes:number}; tileDebt:Record<string,{resident:number;triangles:number;draws:number}> }
export function tileTilingReport(input:TilingInput):TilingReport;
export function tileBoxVisible(box:{min:readonly number[];max:readonly number[]}, camera:BakeCamera):boolean;
export function tilingMarkdown(report:TilingReport):string;
export function checkNineTiling(report:TilingReport, baseline:unknown):void;
export function readTilingReport(root:string, product:string, folder:string):TilingReport;
export function reportTileBake(root:string, product:string, folder:string):TilingReport;
