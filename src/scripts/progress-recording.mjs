/** Record the existing progress orbit with the original native capture settings.
 * Only URL/byte metadata returns to Node; its caller owns object-URL cleanup.
 * @param {{secs:number,center:readonly [number,number,number],radius:number,height:number,startDeg:number,sweepDeg:number,fov?:number}} c
 * @returns {Promise<{url:string,bytes:number}>} */
export async function recordProgressClip(c) {
  const canvas=document.querySelector('canvas');if(!canvas)throw new Error('no canvas');
  const target=/** @type {Window & {__prog?:{pos:readonly number[],look:readonly number[],fov:number}}} */ (window);
  const stream=canvas.captureStream(30);
  let blob;
  try {
    const rec=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:8_000_000});
    /** @type {Blob[]} */
    const parts=[];rec.ondataavailable=e=>{if(e.data.size>0)parts.push(e.data);};
    const start=performance.now();
    const step=()=>{
      const t=(performance.now()-start)/1000/c.secs,a=c.startDeg*Math.PI/180+t*c.sweepDeg*Math.PI/180;
      target.__prog={pos:[c.center[0]+Math.sin(a)*c.radius,c.center[1]+c.height,c.center[2]+Math.cos(a)*c.radius],look:c.center,fov:c.fov??60};
      if(t<1)requestAnimationFrame(step);
    };
    rec.start(250);step();
    await new Promise(resolve=>{setTimeout(resolve,c.secs*1000);});
    await new Promise(resolve=>{rec.onstop=()=>{resolve(undefined);};rec.stop();});
    blob=new Blob(parts,{type:'video/webm'});
  } finally {for(const track of stream.getTracks())track.stop();}
  return {url:URL.createObjectURL(blob),bytes:blob.size};
}
