/** BUDGET-CAPS BC12 (J410, J431, J445): the one phone memory line in engine, a zone's loading memory hard cap in decimal
 * bytes. It is budgets/caps.json `memory/loading/*` `hard`; test/budget-phone-line.test.ts fails when the two differ. */
export const PHONE_MEMORY_LOADING_CAP_BYTES: number = 1.5e9;
