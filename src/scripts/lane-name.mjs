// Meta QA 11-25 row 43: main-push and land run only under a lane name. With none they once called themselves
// `main-push` or `land`, so row 37's HOLD guard read the HOLD's own named lander (opus-ma, 11-25 14:35 UTC) as a stranger
// and stopped its red fix, and its receipts and `Lane:` trailers named no one.

const LANE = /^[a-z][a-z0-9_-]*$/u;

/** The lane this run belongs to, or a refusal that names the variable to set.
 * @param {NodeJS.ProcessEnv} env @param {string} script @returns {{lane:string}|{refusal:string}} */
export function laneName(env, script) {
  const lane = env.WS_LANE_NAME ?? '';
  if (LANE.test(lane)) return { lane };
  return { refusal: `${script} runs only under a lane name: set WS_LANE_NAME=<your lane> (lowercase letters, digits, _ or -, ` +
    `such as WS_LANE_NAME=opus-ma node src/scripts/${script}.mjs ...)${lane === '' ? '' : `; ${JSON.stringify(lane)} is not one`}` };
}
