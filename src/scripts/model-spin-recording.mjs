/** Stop the existing Explorer recorder; expose its immutable clip by an owned
 * object URL rather than copying it into a base64 string. The caller revokes
 * the URL after its binary handoff, including failures.
 * @returns {Promise<{url:string,bytes:number,size:readonly [number,number],drawn:number}>} */
export async function stopSpinRecording() {
  const spin=/** @type {Window & {__spin?:{rec:{rec:MediaRecorder,parts:Blob[],off():void,frames():number,size:readonly [number,number]}}}} */ (window).__spin;
  if(spin===undefined)throw new Error('Missing Explorer recorder');
  const recording=spin.rec;
  recording.off();
  try {
    await new Promise(resolve=>{recording.rec.onstop=()=>{resolve(undefined);};recording.rec.stop();});
  } finally {for(const track of recording.rec.stream.getTracks())track.stop();}
  const blob=new Blob(recording.parts,{type:'video/webm'}),drawn=recording.frames(),size=recording.size;
  return {url:URL.createObjectURL(blob),bytes:blob.size,size,drawn};
}

/** Transfer one already-stopped native clip. Only URL/size metadata crosses the
 * evaluate boundary; its caller owns source URL and destination-route cleanup.
 * @param {{source:string,destination:string}} locations */
export async function uploadRecordedClip({source,destination}) {
  const clip=await fetch(source);
  if(!clip.ok)throw new Error('Recorded clip read refused');
  const response=await fetch(destination,{method:'POST',body:await clip.blob()});
  if(!response.ok)throw new Error('Recorded clip handoff refused');
}
