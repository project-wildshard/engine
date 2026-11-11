/** Queue and direct/release gates execute the same bounded environment policy.
 * Never carry bypasses, injected loaders or arbitrary caller test modes.
 * @param {NodeJS.ProcessEnv} [source] */
export function workerEnvironment(source=process.env){
 const allowed=new Set(['HOME','PATH','USER','LOGNAME','SHELL','TMPDIR','TMP','TEMP','LANG','TZ','TERM','COLORTERM','NO_COLOR','FORCE_COLOR',
  'PNPM_HOME','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','SSH_AUTH_SOCK','SSH_AGENT_PID',
  'HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy',
  'SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS','CPATH','LIBRARY_PATH','MANPATH','SDKROOT','WS_LANE_RECEIPTS']);
 const environment=Object.fromEntries(Object.entries(source).filter(([key])=>allowed.has(key)||/^LC_[A-Z_]+$/u.test(key)));
 return {...environment,WS_FULL_SUITE:'1',GIT_TERMINAL_PROMPT:'0',GIT_SSH_COMMAND:'ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=120 -o TCPKeepAlive=yes'};
}

/** Hook context is established by real Git/lease owners, not an enqueuer mode.
 * CI markers survive so hosted checks can never consume local receipts.
 * @param {NodeJS.ProcessEnv} [source] */
export function gateEnvironment(source=process.env){
 /** @type {NodeJS.ProcessEnv} */const env=workerEnvironment(source);
 for(const key of ['CI','GITHUB_ACTIONS','GITHUB_SHA','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','WS_PUSH_REFS','WS_PUSH_DESTINATION','WS_PUSH_TIMINGS',
  'WS_HEAVY_ROOT','WS_HEAVY_TOKEN','WS_HEAVY_TICKET','WS_HEAVY_SCHEDULER_ROOT'])if(source[key]!==undefined)env[key]=source[key];
 return env;
}
