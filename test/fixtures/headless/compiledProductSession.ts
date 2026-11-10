import {afterAll} from 'vitest';
import {compileProductWorker} from './compileProductWorker';
import {beginProductSession} from './productSession';

let pending:ReturnType<typeof compileProductWorker>|undefined;
// Nested physics suites dispose every owned world before this file-level
// teardown removes its private code. Failed preparation cleans itself up.
afterAll(async()=>{const prepared=await pending?.catch(()=>undefined);prepared?.dispose();});

/** Use the original public host's compiled distribution path. Only immutable
 * freshly compiled code is shared; every call still owns a fresh worker. */
export const beginCompiledProductSession:typeof beginProductSession=async(slug,variant,snapshot)=>{
  return beginProductSession(slug,variant,snapshot,async(...args)=>{
    const prepared=await(pending??=compileProductWorker());return prepared.create(...args);
  });
};
