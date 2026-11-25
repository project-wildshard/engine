// HOW-WE-BUILD ENG-16: types for scripts/devserver-client.mjs.
/** The release asset's name; sharddev's `DEV_CLIENT_ASSET` reads the same. */
export declare const DEV_CLIENT_ASSET: string;
/** SA43: the preparation client's asset; sharddev's `PREPARATION_CLIENT_ASSET` reads the same. */
export declare const PREPARATION_CLIENT_ASSET: string;
/** Prune a devserver build (or a preparation-only production build) in place to the client an author's page reads. */
export declare function pruneDevserverClient(client: string, kind?: 'devserver' | 'preparation'): void;
/** TC13: the card art each discovery.json names (`art`), as client-relative paths. */
export declare function discoveryArt(client: string): Set<string>;
/** FP55: drop each discovery KTX2 table row whose file the prune removed; returns the rows dropped. */
export declare function dropDanglingKtx2Rows(client: string): number;
