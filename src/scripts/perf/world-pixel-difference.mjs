/** Full raw RGBA comparison. The optional G941 ruling permits only the two
 * exact Nine world-capture pairs; it never changes bytes or reports them zero.
 * @param {Uint8Array} a @param {Uint8Array} b
 * @param {number} width @param {number} height
 * @param {string} pose @param {boolean} [g941] */
export function worldPixelDifference(a,b,width,height,pose,g941=false){
 if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0||a.length!==width*height*4||b.length!==a.length)throw new Error('World pixel dimensions differ');
 let pixels=0,approvedPixels=0;
 const first=[];
 for(let at=0;at<a.length;at+=4){
  if(a[at]===b[at]&&a[at+1]===b[at+1]&&a[at+2]===b[at+2]&&a[at+3]===b[at+3])continue;
  pixels++;const pixel=at/4,x=pixel%width,y=Math.floor(pixel/width);
  const before=[a[at],a[at+1],a[at+2],a[at+3]],after=[b[at],b[at+1],b[at+2],b[at+3]];
  const pair=(one,other)=>(before.every((n,i)=>n===one[i])&&after.every((n,i)=>n===other[i]))||(before.every((n,i)=>n===other[i])&&after.every((n,i)=>n===one[i]));
  const approved=g941&&width===804&&height===1748&&(
   pose==='P1'&&x===569&&y===1139&&pair([14,15,15,1],[15,16,15,1])||
   pose==='P2'&&x===591&&y===715&&pair([26,30,22,1],[25,30,22,1]));
  if(approved)approvedPixels++;
  if(first.length<20)first.push({x,y,before,after,approved});
 }
 return {pixels,approvedPixels,unapprovedPixels:pixels-approvedPixels,first};
}
