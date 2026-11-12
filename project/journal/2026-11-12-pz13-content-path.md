# PAGE-SIZE PZ13: a content base with a path

- Red first: `content-base.test.ts` asks for PZ2's `https://packs.wildshard.io/content/<set>/` base (accepted, path kept on
  every read: spawn download, server worker, boot tables, title art) and still refuses a query, a relative base and
  another scheme. Before this row the client refused any path but `/`.
