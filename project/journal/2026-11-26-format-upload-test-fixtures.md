# Run pin tests with the matching admission policy

Format 0.82.2 refuses carried KTX2 and mounts outside a shard's URL prefix
on a new upload. The local pin tests now admit an images-only Brasscap
seed with a local mount under its own prefix. The mirror still restores
the original published pin. The cook's refusal parity tests validate the
pinned Dunes product using the cook's stored admission policy.

This fixture was prepared from sharddev commit `6378befd` with its pinned
dependencies. Run the following from that checkout to regenerate it.

```js
import {writeFile} from 'node:fs/promises';
import {brotliCompressSync} from 'node:zlib';
import {makeShardfile} from './packages/dev/src/test/helpers/shardfile.ts';

const bytes = await makeShardfile({
  slug: 'brasscap-mesa',
  shardVersion: '0.0.1',
  name: 'Brasscap Mesa',
});
await writeFile('pin-local-brasscap.tar.br', brotliCompressSync(bytes));
```

Copy the resulting file to `test/fixtures/pin-local-brasscap.tar.br`.
