/** Proof-only, after controls: size existing cached copies without fetching.
 * Presence here never proves a cache hit during boot. This function is injected
 * into Safari, so keep its bounds and dependencies inside the function. */
export async function cachedBodyEvidence(input, descriptor) {
  const limits = { urls: 1024, caches: 16, bodyBytes: 8 * 1024 * 1024, metadataBytes: 1024 * 1024, totalBytes: 64 * 1024 * 1024, milliseconds: 5000 };
  if (!Array.isArray(input) || input.length > limits.urls) throw new Error('Invalid cache evidence URL bank');
  const urls = [];
  for (const value of input) {
    if (typeof value !== 'string') throw new Error('Invalid cache evidence URL');
    const url = new URL(value, location.href);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== location.origin
      || url.username !== '' || url.password !== '' || url.hash !== '') throw new Error('Foreign cache evidence URL');
    if (!urls.includes(url.href)) urls.push(url.href);
  }
  const selected = descriptor === undefined ? null : new URL(descriptor, location.href);
  if (selected !== null && (selected.origin !== location.origin || selected.username !== '' || selected.password !== ''
    || selected.search !== '' || selected.hash !== '' || !/^\/shardfiles\/[a-zA-Z0-9_-]+\/shard\.json$/u.test(selected.pathname))) throw new Error('Invalid cache evidence descriptor');
  const started = performance.now(), files = [], missing = [], failures = [];
  let readBytes = 0, limited = null, product = null;
  const result = () => ({ unit: 'decoded cached response bodies', source: 'post-control cached copies; not cache-hit evidence',
    requested: urls.length, files, missing, failures, readBytes, limited, limits, product });
  if (typeof caches === 'undefined') { limited = 'CacheStorage unavailable'; return result(); }
  const bounded = async work => {
    let timer;
    try {
      return await Promise.race([work, new Promise((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error('Cache evidence time limit')); }, Math.max(0, limits.milliseconds - (performance.now() - started)));
      })]);
    } finally { clearTimeout(timer); }
  };
  let names;
  try { names = await bounded(caches.keys()); }
  catch { limited = 'time or cache enumeration failure'; return result(); }
  if (names.length > limits.caches) { limited = 'cache count'; return result(); }
  if (selected !== null) {
    const record = new URL('__visited_shardfile__', selected).href;
    let reader;
    try {
      const response = await bounded(caches.match(record));
      if (response === undefined || !response.ok || response.body === null || response.type === 'opaque') throw new Error('Missing selected product record');
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let text = '', recordBytes = 0;
      while (true) {
        const chunk = await bounded(reader.read());
        if (chunk.done) break;
        recordBytes += chunk.value.byteLength; readBytes += chunk.value.byteLength;
        if (recordBytes > limits.metadataBytes) throw new Error('Product metadata bytes');
        text += decoder.decode(chunk.value, { stream: true });
      }
      const stored = JSON.parse(text + decoder.decode()), index = stored?.source;
      if (stored?.firstParty !== true || index?.format !== 'wildshard.shardfile' || index.formatVersion !== 2
        || index.identity?.slug !== selected.pathname.split('/')[2]) throw new Error('Invalid selected product record');
      const inventory = [], paths = new Set();
      for (const [kind, size] of [['sections', 'bytes'], ['schemas', 'bytes'], ['files', 'compressed']]) {
        if (!Array.isArray(index[kind]) || index[kind].length > limits.urls) throw new Error('Invalid product inventory');
        for (const row of index[kind]) {
          if (row === null || typeof row !== 'object' || typeof row.path !== 'string'
            || !/^(?:[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/u.test(row.path)
            || paths.has(row.path) || typeof row.hash !== 'string' || !/^[a-f0-9]{64}$/u.test(row.hash)
            || !Number.isSafeInteger(row[size]) || row[size] < 0) throw new Error('Invalid product inventory row');
          paths.add(row.path);
          inventory.push({ url: new URL(row.path, selected).href,
            contentURL: new URL(`/__ws_content__/v0/${row.hash}`, selected).href, expectedBytes: row[size] });
        }
      }
      const expanded = [...new Set([...urls, selected.href, ...inventory.flatMap(row => [row.url, row.contentURL])])];
      if (expanded.length > limits.urls) throw new Error('Product evidence URL bank');
      urls.splice(0, urls.length, ...expanded);
      product = { descriptor: selected.href, record, recordBytes, files: inventory };
    } catch (error) {
      failures.push({ url: record, reason: String(error) }); limited = 'selected product metadata'; return result();
    } finally { if (reader !== undefined) { void reader.cancel().catch(() => { /* Cleanup cannot hold the reader. */ }); reader.releaseLock(); } }
  }
  // A concurrent cache removal must not make open() create a replacement cache.
  // CacheStorage.match searches existing stores and does not create or write one.
  for (const url of urls) {
    if (performance.now() - started >= limits.milliseconds) { limited = 'time'; break; }
    if (readBytes >= limits.totalBytes) { limited = 'total bytes'; break; }
    let reader;
    try {
      const response = await bounded(caches.match(url));
      if (response === undefined) { missing.push(url); continue; }
      if (response.type === 'opaque' || response.body === null) { failures.push({ url, reason: 'unreadable body' }); continue; }
      reader = response.body.getReader();
      let bytes = 0, complete = false;
      while (true) {
        if (performance.now() - started >= limits.milliseconds) { limited = 'time'; break; }
        const chunk = await bounded(reader.read());
        if (chunk.done) { complete = true; break; }
        bytes += chunk.value.byteLength; readBytes += chunk.value.byteLength;
        if (bytes > limits.bodyBytes) { failures.push({ url, reason: 'body bytes' }); break; }
        if (readBytes > limits.totalBytes) { limited = 'total bytes'; break; }
      }
      if (complete) files.push({ url, bytes });
    } catch (error) {
      failures.push({ url, reason: String(error) });
      if (performance.now() - started >= limits.milliseconds) limited = 'time';
    } finally { if (reader !== undefined) { void reader.cancel().catch(() => { /* Cancellation cannot block evidence cleanup. */ }); reader.releaseLock(); } }
    if (limited !== null) break;
  }
  return result();
}
