// Clone origin main for a queue batch, borrowing objects from a local snapshot.
import {execFileSync} from 'node:child_process';

/** A snapshot's stamp commit lets git's auto-maintenance write a commit-graph.
 * When that graph holds origin's tip, `clone --reference --dissociate` closes the
 * graph while commits parsed from it still need it for their trees, and checkout
 * dies with "unable to parse commit <tip>" (fixed upstream in git 3d8e400). The
 * clone never needs the graph, so it reads none.
 * @param {string} reference @param {string} remote @param {string} target @param {NodeJS.ProcessEnv} env */
export function cloneQueueOrigin(reference,remote,target,env){
 execFileSync('git',['-c','core.commitGraph=false','clone','--quiet','--branch=main','--reference-if-able',reference,'--dissociate',remote,target],{env,stdio:'pipe'});
}
