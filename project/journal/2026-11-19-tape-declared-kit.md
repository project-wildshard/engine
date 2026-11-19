# Tape attacks swing a declared kit (meta ONE-FORMAT OF42b)

- opus-of-rows: the data worker (`headlessWorker.ts`) now installs the shard's declared kit with its simulation and on
  restore, as cellWorld does, and hands each tape player command to it as a client's wire command
  (`tapeKitCommand`): an `attack` aims from the eye at its target, a free `swing` along the look, `heavy` is the hold.
  Before, a tape's attack reached native catalogue weapons only, so sharddev's OF42 fight ran on the cell server.
- Surprise: a snapshot from a worker with a kit carries `items.declared-kit`; a test restoring it in-process must
  install the kit too, or the restore refuses the registration.
