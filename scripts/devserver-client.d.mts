// HOW-WE-BUILD ENG-16: types for scripts/devserver-client.mjs.
/** The release asset's name; sharddev's `DEV_CLIENT_ASSET` reads the same. */
export declare const DEV_CLIENT_ASSET: string;
/** Prune a devserver build in place to the client an author's page reads. */
export declare function pruneDevserverClient(client: string): void;
