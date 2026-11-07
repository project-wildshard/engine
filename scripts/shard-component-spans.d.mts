import type { Component, ComponentInventory, ComponentSpan } from './shard-components.mjs';
import type { CustomSource } from './shard-platform.mjs';

export interface ComponentSpanInput {
  customSources?:CustomSource[];
  components?:ComponentInventory;
  conversion:{customRuntimeLines:number};
}
export interface ComponentSpanReport {
  schema:'shard-platform-spans/1';measurement:'source';shard:string;
  total:number|null;counts:Record<Component,number>|null;
  spans:ComponentSpan[]|null;unknown:string[]|null;measurementError:string|null;
}
export function componentSpanReports(root:string,inventory:Partial<Record<string,ComponentSpanInput>>,slugs:readonly string[],measurementError:string|null):Record<string,ComponentSpanReport>;
export function writeComponentSpans(directory:string,input:unknown,revision:string):void;
