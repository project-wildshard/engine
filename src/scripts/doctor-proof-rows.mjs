/** The native Doctor proof's row predicate. Private-health publication is proved separately on the tailnet. */
/** Page metadata must agree with the already signature-verified release, including when proving an earlier release.
 * @param {unknown} pageEpoch @param {unknown} signedEpoch */
export function doctorEpochOK(pageEpoch, signedEpoch) {
  return typeof signedEpoch === 'number' && Number.isSafeInteger(signedEpoch) && signedEpoch > 0 && pageEpoch === signedEpoch;
}

/** @param {readonly {id?:string,state?:string,value?:string|null}[]} rows @param {string} socket */
export function doctorRowsOK(rows, socket) {
  if(rows.length!==7||rows.map(row=>row.id).join(',')!=='page,release,packs,server,join,latency,browser')return false;
  return rows.every(row=>{
    if(row.id!=='server')return row.state==='pass';
    if(new URL(socket).host!=='rooms-staging.wildshard.io')return row.state==='pass';
    return row.state==='skip'&&row.value==='rooms-staging.wildshard.io · health is private, Join checks the door'
      ||row.state==='pass'&&row.value==='rooms-staging.wildshard.io reachable · health is private';
  });
}
