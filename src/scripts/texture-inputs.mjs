// E357 J4: the texture tier generator and deletion audit share their input/output plan.
export function textureTierJobs(files) {
  const paths = new Set(files);
  const jobs = [];
  for (const source of paths) {
    if (!/^public\/assets\/tex\/[^/]+\/(diffuse|nor_gl|arm)\.jpg$/.test(source)) continue;
    jobs.push({ kind: 'resize', source, served: source, output: source.replace(/\.jpg$/, '_1k.jpg'), max: 1024 });
    const small = source.replace(/\.jpg$/, '_1k.jpg');
    const served = paths.has(small) ? small : source;
    jobs.push({ kind: 'phone', source, served, output: served.replace(/\.jpg$/, '.phone.webp'), max: source.endsWith('/arm.jpg') ? 512 : 1024 });
  }
  for (const source of paths) if (/^public\/assets\/tex\/[^/]+\/twig_(rgba|nor_gl|arm)\.(png|jpg)$/.test(source)) {
    jobs.push({ kind: 'phone', source, served: source, output: source.replace(/\.(png|jpg)$/, '.phone.webp'), max: 1024 });
  }
  return jobs;
}
