/** Shared masked SSIM, optionally returning its map through a binary handoff.
 * @param {{a:string,b:string,diff?:string,mask?:number[][]}} images */
export async function ssim({ a, b, diff: output, mask }) {
  /** @param {string} url */ const decode = async url => {
    const response=await fetch(url);
    if(!response.ok)throw new Error('Parity image read refused');
    return createImageBitmap(await response.blob());
  };
  const ia=await decode(a);
  let ib;
  try {
    ib=await decode(b);
    if (ia.width !== ib.width || ia.height !== ib.height) return { hasDiff:false, ssim: 0, note: `size ${ia.width}×${ia.height} vs ${ib.width}×${ib.height}` };
    const w = ia.width, h = ia.height, W1 = w + 1;
    /** @param {ImageBitmap} bm */ const luma = (bm) => { const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); if (!x) throw new Error('2D canvas unavailable'); x.drawImage(bm, 0, 0); const d = x.getImageData(0, 0, w, h).data; const L = new Float64Array(w * h); for (let i = 0; i < w * h; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; return L; };
    const X = luma(ia), Y = luma(ib);
    /** @param {(i:number)=>number} f */ const integral = (f) => { const S = new Float64Array(W1 * (h + 1)); for (let r = 0; r < h; r++) { let row = 0; for (let c = 0; c < w; c++) { row += f(r * w + c); S[(r + 1) * W1 + c + 1] = S[r * W1 + c + 1] + row; } } return S; };
    const Sx = integral((i) => X[i]), Sy = integral((i) => Y[i]), Sxx = integral((i) => X[i] * X[i]), Syy = integral((i) => Y[i] * Y[i]), Sxy = integral((i) => X[i] * Y[i]);
    const k = 7, N = k * k, cov = N / (N - 1), C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
    /** @param {Float64Array} S @param {number} r @param {number} c */ const box = (S, r, c) => S[(r + k) * W1 + c + k] - S[r * W1 + c + k] - S[(r + k) * W1 + c] + S[r * W1 + c];
    const M = new Uint8Array(w * h);
    for (const [x0, y0, x1, y1] of mask ?? []) for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++) M.fill(1, y * w + Math.max(0, Math.floor(x0)), y * w + Math.min(w, Math.ceil(x1)));
    const Sm = integral((i) => M[i]);
    const diff = output===undefined?undefined:new OffscreenCanvas(w, h), dx = diff?.getContext('2d');
    if(diff!==undefined&&!dx)throw new Error('2D canvas unavailable');
    const pixels = dx?.createImageData(w,h);
    let sum = 0, n = 0, all = 0, nAll = 0;
    for (let r = 0; r + k <= h; r++) for (let c = 0; c + k <= w; c++) {
      const mx = box(Sx, r, c) / N, my = box(Sy, r, c) / N;
      const vx = (box(Sxx, r, c) / N - mx * mx) * cov, vy = (box(Syy, r, c) / N - my * my) * cov, vxy = (box(Sxy, r, c) / N - mx * my) * cov;
      const s = ((2 * mx * my + C1) * (2 * vxy + C2)) / ((mx * mx + my * my + C1) * (vx + vy + C2));
      if(pixels!==undefined){const at = ((r+3)*w+c+3)*4; pixels.data[at]=Math.round(255*(1-Math.max(0,s))); pixels.data[at+3]=255;}
      all += s; nAll++;
      if (box(Sm, r, c) > 0) continue;
      sum += s; n++;
    }
    if(output!==undefined&&diff!==undefined&&dx&&pixels!==undefined) {
      dx.putImageData(pixels,0,0);
      const response=await fetch(output,{method:'POST',body:await diff.convertToBlob({type:'image/png'})});
      if(!response.ok)throw new Error('Parity diff handoff refused');
    }
    return { hasDiff:output!==undefined, ssim: n > 0 ? sum / n : null, full: all / nAll, masked: Math.round((1 - n / nAll) * 1000) / 1000, note: n === 0 ? 'the whole frame is masked' : null };
  } finally {ia.close();ib?.close();}
}
