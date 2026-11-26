/** Fix-preview PV9 (Jake, 2026-11-26: "folder per build but human readable `builds/[engineVersion]/[build]/*`"): a
 * build's own code sits under `/builds/<engineVersion>/<build>/`, was `/b/<build>/`. The document stamps both halves
 * (`__WS_CLIENT_VERSION__` is package.json's version, the one `src/scripts/app-build/buildIdentity.mjs` `codeDirectory`
 * names the folder by, and `__WS_BUILD_ID__`), so no content-named chunk carries either. */

const stamp = (name: string): string => {
  const value: unknown = Reflect.get(globalThis, name);
  return typeof value === 'string' ? value : '';
};

/** This page's build's code folder, with no trailing slash: `/builds/0.1.97/2476a98-mabc123`. */
export function buildCodeFolder(build: string = stamp('__WS_BUILD_ID__'), engineVersion: string = stamp('__WS_CLIENT_VERSION__')): string {
  return `/builds/${engineVersion}/${build}`;
}

/** The build whose own code folder holds `pathname`, in either layout: `/builds/<engineVersion>/<build>/…` or the
 *  legacy `/b/<build>/…` of a build from before PV9. The shared folder (`/builds/shared/`, legacy `/b/c/`) is no build's. */
export function codeFolderBuildOf(pathname: string): string | undefined {
  const match = /^\/(?:builds\/(?!shared\/)[\w.-]+|b)\/([\w.-]+)\//u.exec(pathname);
  return match === null || match[0] === '/b/c/' ? undefined : match[1];
}
