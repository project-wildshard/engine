import type {FloorGridState} from '@wildshard/engine/scripts/frame-floor-grid.mjs';

export interface PlotGoldenView {
  n:number;name:string;label:string;player:[number,number];eye:[number,number,number];look:[number,number,number];
  hfov:62;aspect:'2:3';world:{eye:[number,number,number];look:[number,number,number];fov:number};inside:string|null;note?:string;
}
export interface PlotGoldens {schema:'golden-cameras/1';slug:string;instance:string;origin:{x:number;z:number};pitch:number;convention:string;views:PlotGoldenView[]}
export function parsePlotGoldens(input:unknown):PlotGoldens;
export function plotGoldenCamera(row:Pick<PlotGoldenView,'eye'|'look'|'hfov'>,origin:{x:number;z:number}):{eye:number[];look:number[];fov:number};
export function plotGoldenPlacement(plan:PlotGoldens,grid:Pick<FloorGridState,'pitch'|'cells'>):{
  instance:string;origin:{x:number;z:number};pitch:number;sourceInstance:string;sourceOrigin:{x:number;z:number};
};
