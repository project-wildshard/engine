import {afterAll} from 'vitest';
import {compileProductWorker} from './compileProductWorker';
import {beginProductSession} from './productSession';

// FL28: the one compile is this file's setup, not the first plot's beforeAll. That hook used to pay
// the compile and its own world under one 10 s budget, and a loaded runner timed it out (48 copies at
// once: 48 of 48 red). The module awaits it once while the file loads; each plot's hook pays only its
// own world. A failed compile cleans itself up and fails the file.
const prepared=await compileProductWorker();
// Nested physics suites dispose every owned world before this file-level
// teardown removes its private code.
afterAll(()=>{prepared.dispose();});

/** Use the original public host's compiled distribution path. Only immutable
 * freshly compiled code is shared; every call still owns a fresh worker. */
export const beginCompiledProductSession:typeof beginProductSession=(slug,variant,snapshot)=>
  beginProductSession(slug,variant,snapshot,prepared.create);
