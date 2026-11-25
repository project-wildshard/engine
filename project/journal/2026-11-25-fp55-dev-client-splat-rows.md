# FP55: the dev client drops the KTX2 rows it pruned

`wildshard dev` on a devserver client died at level.world: "Splat layer /assets/pine-hollow/splat/... answered 404". The
client keeps each pinned shard's discovery.json (the title deck reads it) but prunes the shard's asset folders, and a
pinned Pine's phone KTX2 table named its cooked splat layers there. An author's candidate with the same splat blobs (the
same slug, so keying by folder could not tell them apart) took those rows and read files the client never ships. Stand-in
rows recover through `retireGpuFile`; the splat layer read has no fallback. The prune now drops every table row whose
file it removed (`dropDanglingKtx2Rows`), so the page reads its own blob.
