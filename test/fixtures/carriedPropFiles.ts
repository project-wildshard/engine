// oxlint-disable-next-line import/no-nodejs-modules -- Runtime host fixtures retain the complete original raw carried geometry.
import {readFileSync} from 'node:fs';

export const carriedPropBytes=Uint8Array.from(readFileSync('test/fixtures/nalati-quest-prop-original.bin'));
export const carriedPropFiles:ReadonlyMap<string,Uint8Array>=new Map([['models/specimens/quest-prop.bin',carriedPropBytes]]);
