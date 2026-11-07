// Explicit native-read fixture preload; ordinary module imports install nothing.
import {resolve} from 'node:path';
import {startGenerationInputTrace} from '../../scripts/shardfile-inputs.mjs';

if(process.execArgv.some((arg,index)=>arg==='--import'&&resolve(process.execArgv[index+1]??'')===import.meta.filename)) {
  const receipt=process.env.WS_GENERATION_READ_RECEIPT;
  if(receipt===undefined)throw new Error('Generation read receipt is missing');
  startGenerationInputTrace(process.cwd(),receipt);
}
