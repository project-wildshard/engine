/** Page.evaluate has no Playwright timeout. Bound simulation phases explicitly.
 * @template T @param {Promise<T>} task @param {number} milliseconds @param {string} phase @returns {Promise<T>} */
export async function within(task,milliseconds,phase) {
  let timer=/** @type {ReturnType<typeof setTimeout>|undefined} */(undefined);
  try {return await Promise.race([task,new Promise((_resolve,reject)=>{timer=setTimeout(()=>{reject(new Error(`infrastructure: ${phase} did not finish within ${milliseconds/1000}s`));},milliseconds);})]);}
  finally {if(timer!==undefined)clearTimeout(timer);}
}
