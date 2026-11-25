/** Meta QA 11-25 row 43: the lane this run belongs to, or a refusal that names WS_LANE_NAME. */
export function laneName(env: NodeJS.ProcessEnv, script: string): { lane: string } | { refusal: string };
