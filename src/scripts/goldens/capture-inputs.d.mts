export const DEFAULT_GOLDEN_CAMERAS: string;
export function goldenPreviewIdentity(value:unknown,expected?:string):{build:string;sha:string};
export function selectGoldenShards(cameras:Readonly<Record<string,unknown>>,requested?:string):string[];
export function selectGoldenCameraNumbers(value:string):Set<number>|null;
