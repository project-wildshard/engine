/** Omit public Vercel maps while retaining their original build/CI copies. */
export function stripDeploySourceMaps(directory: string): {files: number; bytes: number};
