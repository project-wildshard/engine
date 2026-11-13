// HOW-WE-BUILD ENG-16: types for scripts/devserver-client.mjs.
/** The release asset's name; sharddev's `DEV_CLIENT_ASSET` reads the same. */
export declare const DEV_CLIENT_ASSET: string;
/** SA43: the preparation client's asset; sharddev's `PREPARATION_CLIENT_ASSET` reads the same. */
export declare const PREPARATION_CLIENT_ASSET: string;
/** Prune a devserver build (or a preparation-only production build) in place to the client an author's page reads. */
export declare function pruneDevserverClient(client: string, kind?: 'devserver' | 'preparation'): void;
