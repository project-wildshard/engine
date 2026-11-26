/** The native Doctor proof's row predicate. Private-health publication is proved separately on the tailnet. */
/** Page metadata must agree with the already signature-verified release, including when proving an earlier release.
 * @param {unknown} pageEpoch @param {unknown} signedEpoch */
export declare function doctorEpochOK(pageEpoch: unknown, signedEpoch: unknown): boolean;
/** @param {readonly {id?:string,state?:string,value?:string|null}[]} rows @param {string} socket */
export declare function doctorRowsOK(rows: readonly {
    id?: string;
    state?: string;
    value?: string | null;
}[], socket: string): boolean;
